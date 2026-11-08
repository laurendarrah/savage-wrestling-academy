# Route reference

Every route the Worker serves, checked against `app/` and the build's route list on November 7, 2026 (#267). The November 5 handoff's version listed 18 API routes and said checkout and the Stripe webhook did not exist; it is in [the archive](archive/handoff-2026-11-05/README.md).

This is a map, not a contract. Each `route.ts` starts with a comment saying what it does, and most actions are a field in a POST body rather than separate paths. Read the route and the `lib/` file it calls before writing a client, and look at its test in `tests/`. Every route checks who is asking on the server; a hidden link never grants access. Mutations take same-origin JSON.

Access: **Public** (anyone), **Family** (any verified account, for its own records), **Coach** (an active coach with the authenticator; the owner too once he has added himself as a coach), **Owner** (the owner with the authenticator).

## API routes (`app/api/*/route.ts`)

### Public and system

| Route | Methods | Access | What it does |
|---|---|---|---|
| `/api/public-schedule` | GET | Public | The public month calendar: practices, days off, named practices, events. Cross-origin reads allowed |
| `/api/registration` | GET, POST | Public GET, Family POST | Programs and prices; the family's registration review. Pricing and eligibility from `lib/quotes.ts` |
| `/api/auth` | GET, POST | Public | Session status, sign-in, sign-up, resend, password reset and change, sign-out |
| `/api/security` | GET, POST | Signed in | Authenticator setup and challenge |
| `/api/coach-invite` | POST | Public, then signed in | Check a coach invite, and accept it for the invited email |
| `/api/health` | GET | Public | Uptime check used by the Deploy workflow and the uptime monitor. Reveals nothing private |
| `/api/stripe-webhook` | POST | Stripe | The only place an order becomes paid. Verifies the signature for the event's own mode, stores each event id once, handles late and out-of-order events |

### Families

| Route | Methods | What it does |
|---|---|---|
| `/api/family` | GET, PUT | The family profile and wrestlers, with each wrestler's card status |
| `/api/booking-review` | POST | Review an event, Friday Night Live or lesson booking, priced by `lib/quotes.ts` |
| `/api/checkout` | POST | Start Stripe Checkout for a reviewed purchase, only for types open in `CHECKOUT_KINDS` |
| `/api/cash-bookings` | GET, POST | Book a walk-in or extra practice to pay cash at the academy, or cancel it before it starts |
| `/api/orders` | GET | The family's own orders and cash bookings |
| `/api/lessons` | GET, POST | Lesson formats, prices and open coach times; book, join or organise a private group |
| `/api/program-approvals` | GET, POST | Ask for SWA Advance approval and see its status |
| `/api/approval-chat` | GET, POST | The private chat about an approval (family and owner) |
| `/api/scholarship` | GET, POST | Open a scholarship invitation and accept it with a drawn signature |
| `/api/waiver` | GET, POST | Sign the waiver, or the Parent Consent Form with `?kind=parent_consent` |
| `/api/passes` | GET, POST | Read or replace a wrestler's QR pass (the owner can revoke any pass) |
| `/api/usaw-check` | POST | Check one of the family's cards on USA Wrestling's verify page. Rate-limited and cached |
| `/api/wrestler` | GET | The wrestler view: pass, what is coming up, what blocks booking |
| `/api/inbox` | GET, POST | Announcements and the private thread with the academy |
| `/api/my-data` | GET, POST | Download all of the family's data; ask to close the account |

### Coaches

| Route | Methods | What it does |
|---|---|---|
| `/api/coach` | GET, POST | Coach home: assigned programs, today, own lesson openings |
| `/api/coach-profile` | GET, POST | A coach's own profile (the owner can edit any coach's) |
| `/api/coach-time` | GET, POST | Clock in and out, correct and send the month, ask for time off |
| `/api/contract` | GET, POST | Read and sign the coach contract in force |
| `/api/practice-plans` | GET, POST | Owner writes and publishes practice plans; coaches read published plans and their month calendar |
| `/api/roster` | GET, POST | Roster and check-in (owner: any date; coach: today, own programs and every extra practice), and **Cash received** |

### Owner

| Route | Methods | What it does |
|---|---|---|
| `/api/academy` | GET, PUT | The academy settings document (programs, schedules, events, team codes), with revision checks |
| `/api/launch-checklist` | GET | What is ready and what is left before launch |
| `/api/accounts` | POST | Delete a family account (payments stay for the books) |
| `/api/owner-approvals` | GET, POST | Decide SWA Advance approvals |
| `/api/scholarships` | GET, POST | Create, revise, rotate, revoke and end scholarship offers |
| `/api/waivers` | GET, POST | Publish and retire the waiver, the Parent Consent Form (`?kind=parent_consent`) or the coach contract (`?kind=coach_contract`); see who signed; ask for a signature again |
| `/api/exceptions` | GET, POST | Dated exceptions to the card, waiver and consent-form booking blocks |
| `/api/usaw-cards` | GET, POST | Review every wrestler's card; mark verified or not valid |
| `/api/payments` | GET, POST | Every payment with totals and CSV; record and void offline payments; unpaid cash bookings |
| `/api/payment-setup` | GET, POST | Connect the academy's Stripe account with a restricted key, test or live |
| `/api/transfers` | GET, POST | Move a paid membership to another program |
| `/api/messages` | GET, POST | Announcements and family threads; retry emails that didn't send |
| `/api/staff` | GET, POST | Invite, change, remove and restore coaches; add yourself as a coach |
| `/api/coach-openings` | GET, POST | Manage any coach's lesson openings with the same rules as coach home |
| `/api/lesson-settings` | GET, POST | Lesson prices per format and each coach's share |
| `/api/coach-pay` | GET | Coach pay from lessons for a period, JSON or CSV |
| `/api/timesheets` | GET, POST | Review, correct, void and approve coach hours; decide time off; the month's file |
| `/api/financials` | GET, POST | Income and expenses by month and year, CSV, and the owner's own entries |
| `/api/practice-curricula` | GET, POST | Curriculum groups and their ordered lessons |
| `/api/website` | GET, POST | Edit, preview and publish the public welcome and team pages |
| `/api/backups` | GET, POST | Download the encrypted backup in batches; preview and restore a file |
| `/api/site-health` | GET, POST | Recent server errors, alerts, emails that didn't send; send a test alert |
| `/api/data-requests` | GET, POST | Families' closure requests and how they were handled |

## Pages (`app/**/route.ts`)

Most pages are `screen.html` served by the route next to it; a few build their HTML in `route.ts`.

| Who | Pages |
|---|---|
| Public | `/welcome` (signed-out home), `/team`, `/calendar`, `/help`, `/login`, `/membership-terms`, `/coach-join` (coach invite), `/auth/confirm` (Supabase email links), `/scholarship-signature-preview` (try the signature form with a fictional agreement; nothing is saved) |
| Everyone | `/` sends each person home: the owner's dashboard (`app/portal.html`), coach home, family home, or `/welcome` |
| Families | `/family`, `/register`, `/booking`, `/lesson`, `/waiver`, `/consent`, `/pass`, `/wrestler`, `/inbox`, `/scholarship`, `/security` |
| Coaches | `/coach`, `/coach-profile`, `/coach-time`, `/contract`, `/practice-plans`, `/roster`, `/help/coach` |
| Owner | `/accounts`, `/account-setup`, `/approvals`, `/scholarships`, `/waivers`, `/consent-forms`, `/contracts`, `/transfers`, `/cards`, `/payments`, `/payment-setup`, `/messages`, `/staff`, `/coach-openings`, `/lesson-settings`, `/timesheets`, `/coach-pay`, `/financials`, `/curricula`, `/website`, `/backups`, `/site-health`, `/security-log`, `/data-requests`, `/help/owner` |
| Printable copies | `/scholarship-agreement` (a signed scholarship agreement) and `/waiver-copy` (a signed waiver), for the owner or the family that signed |

The owner's sidebar and the dashboard's tool list both come from `lib/owner-nav.ts`.
