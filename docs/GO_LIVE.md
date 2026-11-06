# Publishing main to the live site

For whoever publishes to the ChatGPT Sites project (issue #9). Follow the steps in order. The first publish can happen with online payments still closed: families can sign up and register, and the owner can record offline payments and run real rosters.

## 1. Before publishing

- [ ] **Back up the live database.** Owner workspace → Run the academy → Backups → download an encrypted backup. Keep the file and passphrase outside the Sites project (#17). The backup made by the current live code (version 2) can still be restored after publishing. Backups made after publishing (version 3) also include payments, attendance, signed waivers, waitlists, messages and every other new table (#78).
- [ ] **Confirm nobody has edited in Sites since the handoff.** Main in GitHub is the source of truth (#8). If Sites has newer changes, stop and bring them into GitHub first.

## 2. Database migrations

Main adds fifteen migrations to the 13 the live site already has. Apply them to the live D1 database in this order, once each, before or as part of publishing. All but one only add tables or columns. **0019 rebuilds the `orders` table** to allow lesson orders: it copies every order into a new table with the same columns and indexes, then swaps it in. Take the backup in step 1 first, and afterwards check that the number of orders is unchanged.

| File | What it adds |
|---|---|
| `drizzle/0013_watery_wolf_cub.sql` | `orders` and `stripe_events` tables |
| `drizzle/0014_adorable_rocket_raccoon.sql` | `attendance` table |
| `drizzle/0015_stale_molten_man.sql` | `subscriptions` table |
| `drizzle/0016_shallow_the_order.sql` | `source` column on `orders` |
| `drizzle/0017_optimal_proteus.sql` | `usaw_reviews` table (owner checks of USA Wrestling cards) |
| `drizzle/0018_curly_ken_ellis.sql` | `waiver_versions` and `waiver_signatures` tables |
| `drizzle/0019_nostalgic_sheva_callister.sql` | `academy_settings` table, `coach_email` on `coach_openings`, and `orders` rebuilt to allow `lesson` |
| `drizzle/0020_open_mister_fear.sql` | `wrestler_passes` table (QR entry passes) |
| `drizzle/0021_mean_shen.sql` | `waitlist_entries` table |
| `drizzle/0022_clean_loa.sql` | `membership_transfers` table |
| `drizzle/0023_curvy_mac_gargan.sql` | `announcements`, `announcement_recipients` and `family_messages` tables |
| `drizzle/0024_kind_wendigo.sql` | `booking_exceptions` table (owner exceptions to the card and waiver blocks) |
| `drizzle/0025_graceful_karma.sql` | Waiver signatures unique per child name instead of per wrestler entry |
| `drizzle/0026_panoramic_terrax.sql` | `notifications` table (automatic notices) |
| `drizzle/0027_stale_pete_wisdom.sql` | `error_log` table (server errors for the site health page) |

- [ ] Confirm how the Sites platform applies migrations on publish. If it applies `drizzle/` automatically, check afterwards that the new tables exist. If not, apply the fifteen files with the platform's database tools.
- [ ] Never re-run 0000 to 0012; they are already applied.

If a migration is missing, the new pages (roster, payments, family purchases, checkout) return errors. Every page that existed before keeps working.

## 3. Settings in the Sites environment

| Setting | First publish | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Unchanged | Already set |
| `STRIPE_CONFIG_ENCRYPTION_KEY` | Unchanged | Already set. Never change it, or the saved Stripe key cannot be decrypted |
| `APP_ORIGIN` | Leave unset | Defaults to `https://savage-registration-preview.justinaccordino546.chatgpt.site`. Set only when moving to a custom domain |
| `CHECKOUT_KINDS` | **Leave empty** | Online payment stays closed. Open it per purchase type later (section 6) |
| `STRIPE_MODE` | Leave unset (test) | Set to `live` only on go-live day (#26) |
| `STRIPE_TEST_WEBHOOK_SECRET` | Unchanged | Already set |
| `STRIPE_LIVE_WEBHOOK_SECRET` | Leave unset | Needed only for live mode |
| `STRIPE_ACCOUNT_ID` | Leave unset | Only if the live Stripe account differs from the current one (#4) |
| `EMAIL_API_KEY`, `MAIL_FROM` | Leave unset | Set both after decision #87 to email announcements and message notices. Until then messages are in-app only |

## 4. Supabase, before families sign up

- [ ] Authentication → URL configuration: the Site URL and the redirect allowlist include `https://savage-registration-preview.justinaccordino546.chatgpt.site/auth/confirm` (#11). Without this, sign-up confirmation and password reset emails fail.
- [ ] Turn on leaked-password protection (#11).

## 5. Publish, then check each page

Publish main. Then, signed in as the owner with the authenticator:

- [ ] `/calendar` shows the published schedule
- [ ] `/` owner dashboard shows the "Run the academy" panel
- [ ] `/roster` loads for today, with no error
- [ ] `/payments` loads and lists the family accounts in "Record an offline payment"
- [ ] `/payment-setup` says test mode and that checkout is off
- [ ] `/cards` lists wrestlers and their USA Wrestling card status
- [ ] `/waivers` says no waiver is in force
- [ ] `/coach-pay` loads for this month
- [ ] `/waitlists` and `/transfers` load
- [ ] `/messages` loads and says email is not connected
- [ ] `/lesson-settings` loads; `/lesson` shows coach openings (each coach must open `/coach` once so older openings are linked to them)
- [ ] `/accounts`, `/approvals`, `/scholarships`, `/staff`, `/backups` load

With a test family account (not a real family):

- [ ] Sign up with a new email, click the confirmation email, and land on the live site
- [ ] `/family` saves a wrestler without a USA Wrestling card, and shows "No USA Wrestling card · booking is blocked"
- [ ] `/register` refuses a walk-in for that wrestler and links to the family account
- [ ] Add a card number and a future expiration date; `/register` now reviews the walk-in and says payment is not open online yet

Then, as the owner:

- [ ] Record a $0 offline walk-in for the test wrestler on `/payments`, with a note "launch check"
- [ ] The test wrestler appears on `/roster` for that practice; check in, then undo
- [ ] From `/family`, open **Wrestler view** for the test wrestler: the paid walk-in is listed under Coming up
- [ ] Open the test wrestler's pass at `/pass` on a phone, tap **Scan passes** on `/roster` on another device, and scan it; then undo the check-in
- [ ] Void the test payment on `/payments`

## Tell families before publishing

After this publish, **no wrestler can book or be recorded for a payment without a current USA Wrestling card on file** (decision #67). Existing members stay on rosters; the roster flags any card that is missing or lapsed. Email families beforehand asking them to add each wrestler's card number and expiration date in their family account.

## Waivers

No waiver is required until the owner publishes one on `/waivers`. Publish only attorney-approved text, and email families first: from that moment, every wrestler needs a signature before booking. If something goes wrong, **Stop requiring this waiver** on the same page lifts the requirement at once.

## 6. Opening online payment later

Only after the matching decision is recorded on its issue:

1. Refund policy decided (#3): set `CHECKOUT_KINDS=walkin,event,live`.
2. Membership terms approved (#2): add `annual`, and later `monthly`.
3. Lesson cancellation and refund policy decided (#80): add `lesson`. Until then, families can review a lesson time and the owner records cash or check lesson payments on `/payments`.
4. Test with Stripe test cards first (#24), then follow the live steps on #26.

The Stripe webhook endpoint must point at `/api/stripe-webhook` and send `checkout.session.*`, `charge.refunded`, `invoice.paid`, `invoice.payment_failed` and `customer.subscription.deleted`.

## After publishing: watch the site

- [ ] Sign up for a free uptime monitor (for example UptimeRobot) and point it at `/api/health` every 5 minutes, with alerts to the owner's phone.
- [ ] Check **Site health** on the owner dashboard the day after publishing. A steady stream of errors means something needs fixing.

## Rolling back

- **Online payment misbehaves:** clear `CHECKOUT_KINDS`. Checkout closes immediately; nothing else changes.
- **Live charging misbehaves:** set `STRIPE_MODE=test`.
- **A page breaks after publishing:** republish the previous Sites version. The new tables can stay; the previous code ignores them.
- **Data problem:** restore from the backup taken in step 1 (owner → Backups).
