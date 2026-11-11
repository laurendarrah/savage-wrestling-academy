# Moving to the academy's Cloudflare account and going live

The academy is leaving ChatGPT Sites and ChatGPT (#100, #119). The site runs as a plain Cloudflare Worker with a D1 database on a Cloudflare account in the academy's name. The **Deploy** workflow in GitHub publishes `main` there. It does nothing until it is switched on (step 3).

Follow the steps in order. The old Sites site keeps running until the domain is switched in step 8, so nothing changes for families before then.

## 1. Accounts (Justin)

- [ ] Create a Cloudflare account in the academy's name. **Recommendation (#274): choose Workers Paid ($5/month) before launch** rather than the free plan. Add Lauren as an administrator.
  - **Why Paid before launch:** the free plan allows about 50 database queries per page load or scheduled run, and Workers Paid allows 1,000. The November 8 engineering audit measured where the free limit breaks: the morning reminders with email on need more than 50 queries at about **650 families**, and the Backups page's download at about **700**; the roster's first load of the day was close behind before #274 moved the reminders off page loads. A few hundred families with email on is enough to be in reach of those limits in a busy season, and the failure mode is quiet (missed reminders, a backup that fails). **Warning signs if the site is still on the free plan:** a backup download that fails, "Last reminder run" on `/site-health` not showing today, or "too many subrequests" errors there. Workers & Pages → Plans in Cloudflare.
- [ ] Decide the site address, for example `register.savagewrestling.com`. Whoever controls the domain's DNS needs to be available on cut-over day.
- [ ] Accept the invite to the new Supabase project (see below).
- [ ] Create the academy's Stripe account yourself (decided on #4): you own it, its payouts and its keys. Step 6 connects it to the site. Add Lauren to it only if you want her help.
- [ ] Set up the email service (Resend) on your own account too, once the email decision (#87) is made. Lauren helps only if you ask.

**Supabase (#139).** The old site's Supabase project was set up through ChatGPT, and no one at the academy can sign in to it. Lauren has created a new project and invites Justin as Owner. Everyone, the owner included, creates their login again on the new site.

## 2. Cloudflare setup (Lauren with Claude Code)

- [ ] Create a D1 database named `savage-wrestling-academy` and note its **database ID**.
- [ ] Create an API token with **Workers Scripts: Edit** and **D1: Edit** for the account. Note the **account ID**.
- [ ] Set the Worker's settings (Workers → the worker → Settings → Variables and secrets, or `wrangler secret put` from a trusted machine):

| Setting | Value |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | From the new Supabase project: Project Settings → API Keys (the publishable key starts `sb_publishable_`) and the Project URL |
| `APP_ORIGIN` | **Required:** sign-up and reset emails fail without it. Until cut-over, the Cloudflare address (`https://<worker>.<account>.workers.dev`). On cut-over day, the real address, for example `https://register.savagewrestling.com` |
| `STRIPE_CONFIG_ENCRYPTION_KEY` | A new random 64-character hex value. The Stripe key is re-entered on `/payment-setup` after the move; saved keys are never moved |
| `STRIPE_TEST_WEBHOOK_SECRET` | From the new Stripe webhook (step 6) |
| `CHECKOUT_KINDS` | **Leave empty.** Online payment opens per purchase type after its terms are decided |
| `STRIPE_MODE` | Leave unset (test) until live-mode day (#26) |
| `STRIPE_ACCOUNT_ID` | **Optional; usually leave unset.** The first test key saved on `/payment-setup` tells the site the academy's Stripe account (step 6). Set it to the account id (`acct_…`) only to pin the account from the start; then every test and live key must belong to it, and the owner can't switch accounts from the page |
| `EMAIL_API_KEY`, `MAIL_FROM` | Leave unset until the email decision (#87). They come from Justin's own Resend account, which he sets up himself (Lauren helps only if asked). Once set, families get emails and the owner gets problem alerts from the site, at most one an hour (#47) |

## 3. Switch on the Deploy workflow (Lauren, in GitHub settings)

Repository → Settings → Secrets and variables → Actions:

- [ ] Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BACKUP_PASSPHRASE` (a long passphrase; store it in the password manager too).
- [ ] Variables: `D1_DATABASE_ID`, `APP_ORIGIN` (the same address as the Worker setting: the Cloudflare address until cut-over), then `DEPLOY_ENABLED` = `true`.

After this, every merge to `main` that passes all checks is published automatically. Each run:
1. backs up the live database, encrypted with `BACKUP_PASSPHRASE`, and keeps it for 30 days
2. applies new database migrations
3. publishes
4. checks `/api/health`

To publish by hand: Actions → Deploy → Run workflow.

## 4. First publish (empty site)

- [ ] Run Deploy by hand. It creates every table on the empty database and publishes.
- [ ] Open `https://<worker>.workers.dev/calendar` and `/api/health`.

## 5. Move the data from the old site

**The old site's backup tool only saves academy settings, family profiles and coach openings.** It leaves out scholarships (including signed agreements), SWA Advance approvals and their conversations, practice plans and curricula. Choose one:

- [ ] **Preferred: a full database export.** If Sites offers a database export (SQL), Justin downloads it, and Lauren imports it into the new database with `wrangler d1 execute DB --remote --file export.sql` before anyone signs up on the new site.
- [ ] **Otherwise:** Justin downloads an encrypted backup on the old site (owner workspace → Backups), and the owner restores it on the new site's `/backups` page. Then he re-creates any scholarship offers (families sign again), re-approves SWA Advance wrestlers, and re-enters practice plans and curricula. Check first how many of each exist.

Logins do not move: the new Supabase project starts empty (#139). Families and the owner sign up again on the new site. Family profiles in the backup stay linked to the old logins, so families re-enter their wrestlers when they sign up again. Ask Justin first how many real families have logins on the old site.

## 6. Supabase and Stripe

- [ ] Supabase → Authentication → URL Configuration: set the Site URL to the new address, and add `https://<new address>/auth/confirm` and `https://<new address>/auth/confirm?next=change` to the redirect URLs.
- [ ] Supabase → Authentication → Sign In / Providers → Email: keep **Confirm email** on.
- [ ] Supabase → Authentication → Multi-Factor: keep **Authenticator app (TOTP)** on. The owner and coaches cannot sign in without it.
- [ ] Supabase → Authentication → Emails → Templates: paste the Savage-branded emails from `docs/email-templates/` (steps in its README).
- [ ] Leaked-password protection, if the Supabase plan allows it.
- [ ] **Email sender.** Supabase's built-in sender delivers only to members of the Supabase project team, a few emails an hour. Testing with Lauren's and Justin's addresses works; families get no confirmation emails until a custom email sender (SMTP) is set under Authentication → Emails. This waits on the email decision (#87).
**Stripe is Justin's own account (#4).** Justin does these steps; Lauren helps only if asked. Everything here is in Stripe's **test mode**: no real money moves.

- [ ] **Create the Stripe account** at [dashboard.stripe.com/register](https://dashboard.stripe.com/register) if it doesn't exist yet. Test mode works before the business details are finished.
- [ ] Stripe (test mode) → Developers → Webhooks: add `https://<new address>/api/stripe-webhook` with `checkout.session.*`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `charge.dispute.closed`, `invoice.paid`, `invoice.payment_failed` and `customer.subscription.deleted`. Put its signing secret in `STRIPE_TEST_WEBHOOK_SECRET` on the Worker (Cloudflare → the worker → Settings → Variables and secrets).
- [ ] Stripe (test mode) → Developers → API keys → **Create restricted key**, named "Savage website test". Give it: reading account details; Checkout Sessions (write); Customers (write); Products and Prices (read); Subscriptions (write); Invoices, PaymentIntents and Charges (read); Balance (read, for card fees, #225); Customer Portal sessions (write). Nothing else. It starts `rk_test_`.
- [ ] As the owner on the new site, paste it on `/payment-setup` and choose **Verify test key**. The page shows the name and id (`acct_…`) of the Stripe account the key belongs to. Check it is the academy's account and choose **Yes, connect this account**. The site records that account (and notes it in Security activity); from then on every test key, and later the live key, must come from it. The page then says "Connected to <account name> (acct_…)".
- [ ] **Sandbox instead of test mode.** Newer Stripe accounts may offer only **sandboxes**. A sandbox key works for testing, but a sandbox has its own account id (`acct_…`), so the site records the sandbox as the academy's account and would refuse the real account's live key. On live day, before saving the live key, add `STRIPE_ACCOUNT_ID` on the Worker as a **Secret** set to the real account's id (Stripe → Settings → Business → Account details, outside the sandbox). The live key is then checked against that account (#302).
- [ ] Connected the wrong account? Choose **Connect a different Stripe account** on the same page and confirm. It removes the saved key and forgets the account (also noted in Security activity), and the next test key decides again. This only works in test mode, and not when `STRIPE_ACCOUNT_ID` is set.
- [ ] No Stripe account or price list is built into the site: checkout sends each price from the program settings, so there are no products or prices to create in Stripe. The old setup's Stripe account and its test price list are gone (#255).

## 7. Check everything on the Cloudflare address

Signed in as the owner, with the authenticator:
- [ ] `/` shows the **Launch checklist** and the Today panel. Work through anything the checklist marks as to do; `/site-health` says the site and database are answering
- [ ] `/welcome` lists SWA Development, SWA Intermediate and SWA Advance. If the checklist offers **Publish the programs**, choose it, then check the practice days and times under Schedules
- [ ] `/roster`, `/payments`, `/cards`, `/waivers`, `/messages`, `/accounts`, `/approvals`, `/scholarships`, `/staff`, `/backups` load with the moved data

With a test family (not a real family):
- [ ] Sign up with a new email, confirm it from the email, and land on the new site
- [ ] `/family` saves a wrestler without a card and shows that booking is blocked; add a card and the walk-in review works
- [ ] As the owner, record a $0 offline walk-in for the test wrestler, find them on `/roster`, scan their pass from `/pass` on a phone, then void the payment

Before families join, run the full launch test pass with a test family in Stripe test mode, then delete the test family: [docs/LAUNCH_TEST_PASS.md](LAUNCH_TEST_PASS.md) (#24). Restore Justin's first backup into a local copy to prove backups work: [docs/RESTORE_DRILL.md](RESTORE_DRILL.md) (#25).

Daily card and waiver reminders now run every morning at 7:41 (8:41 in summer) New York time from a Cloudflare schedule. Nothing to set up; they appear under Workers → the worker → Settings → Triggers. If a morning's run is missed, the site runs them from the first page visit after 10 AM New York and tells the owner (#274); `/site-health` shows "Last reminder run".

## 8. Cut over

- [ ] Email families about USA Wrestling cards (from the moment the new site is live, nobody can book without a current card).
- [ ] On a quiet evening: point the domain at the Worker (Workers → the worker → Settings → Domains & Routes → add the custom domain).
- [ ] Change `APP_ORIGIN` to the real address, both on the Worker and in the GitHub variable, and add it to the Supabase redirect allowlist and the Stripe webhook if you haven't already.
- [ ] Re-run step 7's owner checks on the real address.
- [ ] Set up a free uptime monitor (for example UptimeRobot) on `https://<new address>/api/health` every 5 minutes, alerting the owner's phone.
- [ ] Keep the old Sites site unpublished for two weeks as a fallback, then retire it.

## Rolling back

The full guide for problems after launch (site down, failed deploys, bad update, lost data, payments and webhooks, sign-in and authenticators, emails) is `docs/RUNBOOK.md`.

- **Before step 8:** nothing has changed for families. Fix and redeploy.
- **A bad publish:** Cloudflare → Workers → the worker → Deployments → roll back to the previous version. Database changes are add-only, so the previous version keeps working.
- **A data problem:** restore from the newest encrypted backup on `/backups` (practised in [the restore drill](RESTORE_DRILL.md)). Or decrypt the Deploy run's backup with `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in pre-deploy.sql.enc -out restore.sql -pass pass:<BACKUP_PASSPHRASE>` and import it into a new D1 database.
- **The new site is down after cut-over:** point the domain back to the old Sites site while it is fixed.

## Opening online payment later

Only after the matching decision is recorded on its issue:

1. Refund policy decided (#3): set `CHECKOUT_KINDS=walkin,event,live`.
2. Membership terms approved (#2): add `monthly`. A year paid upfront is not offered (#210).
3. Lesson refund policy decided (#80): add `lesson`.
4. If the test key came from a Stripe sandbox, set `STRIPE_ACCOUNT_ID` to the real account's id first (see step 6).
5. Test with Stripe test cards first ([the launch test pass](LAUNCH_TEST_PASS.md), #24), then follow the live steps on #26. The live key must come from the same Stripe account the test key connected (or `STRIPE_ACCOUNT_ID`, if set). Without either, `/payment-setup` refuses it: "Save your test key first so the site knows your Stripe account."
