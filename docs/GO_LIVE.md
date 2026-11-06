# Moving to the academy's Cloudflare account and going live

The academy is leaving ChatGPT Sites and ChatGPT (#100, #119). The site runs as a plain Cloudflare Worker with a D1 database on a Cloudflare account in the academy's name. The **Deploy** workflow in GitHub publishes `main` there. It does nothing until it is switched on (step 3).

Follow the steps in order. The old Sites site keeps running until the domain is switched in step 8, so nothing changes for families before then.

## 1. Accounts (Justin)

- [ ] Create a Cloudflare account in the academy's name (free plan to start; Workers Paid is $5/month if limits are reached). Add Lauren as an administrator.
- [ ] Decide the site address, for example `register.savagewrestling.com`. Whoever controls the domain's DNS needs to be available on cut-over day.
- [ ] Add Lauren to the Supabase project and the Stripe account.

## 2. Cloudflare setup (Lauren with Claude Code)

- [ ] Create a D1 database named `savage-wrestling-academy` and note its **database ID**.
- [ ] Create an API token with **Workers Scripts: Edit** and **D1: Edit** for the account. Note the **account ID**.
- [ ] Set the Worker's settings (Workers → the worker → Settings → Variables and secrets, or `wrangler secret put` from a trusted machine):

| Setting | Value |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | From the Supabase project (unchanged) |
| `APP_ORIGIN` | **Required:** sign-up and reset emails fail without it. Until cut-over, the Cloudflare address (`https://<worker>.<account>.workers.dev`). On cut-over day, the real address, for example `https://register.savagewrestling.com` |
| `STRIPE_CONFIG_ENCRYPTION_KEY` | A new random 64-character hex value. The Stripe key is re-entered on `/payment-setup` after the move; saved keys are never moved |
| `STRIPE_TEST_WEBHOOK_SECRET` | From the new Stripe webhook (step 6) |
| `CHECKOUT_KINDS` | **Leave empty.** Online payment opens per purchase type after its terms are decided |
| `STRIPE_MODE` | Leave unset (test) until live-mode day (#26) |
| `EMAIL_API_KEY`, `MAIL_FROM` | Leave unset until the email decision (#87) |

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

Family logins keep working either way: the Supabase project doesn't change, and records are keyed by Supabase user.

## 6. Supabase and Stripe

- [ ] Supabase → Authentication → URL configuration: set the Site URL to the new address, add `https://<new address>/auth/confirm` to the redirect allowlist, and turn on leaked-password protection.
- [ ] Stripe → Developers → Webhooks: add `https://<new address>/api/stripe-webhook` with `checkout.session.*`, `charge.refunded`, `invoice.paid`, `invoice.payment_failed` and `customer.subscription.deleted`. Put its signing secret in `STRIPE_TEST_WEBHOOK_SECRET`.
- [ ] As the owner on the new site, save the Stripe test key on `/payment-setup`.

## 7. Check everything on the Cloudflare address

Signed in as the owner, with the authenticator:
- [ ] `/` shows the **Launch checklist** and the Today panel. Work through anything the checklist marks as to do; `/site-health` says the site and database are answering
- [ ] `/roster`, `/payments`, `/cards`, `/waivers`, `/messages`, `/accounts`, `/approvals`, `/scholarships`, `/staff`, `/backups` load with the moved data

With a test family (not a real family):
- [ ] Sign up with a new email, confirm it from the email, and land on the new site
- [ ] `/family` saves a wrestler without a card and shows that booking is blocked; add a card and the walk-in review works
- [ ] As the owner, record a $0 offline walk-in for the test wrestler, find them on `/roster`, scan their pass from `/pass` on a phone, then void the payment

Daily card and waiver reminders now run every morning at 7:41 (8:41 in summer) New York time from a Cloudflare schedule. Nothing to set up; they appear under Workers → the worker → Settings → Triggers.

## 8. Cut over

- [ ] Email families about USA Wrestling cards (from the moment the new site is live, nobody can book without a current card).
- [ ] On a quiet evening: point the domain at the Worker (Workers → the worker → Settings → Domains & Routes → add the custom domain).
- [ ] Change `APP_ORIGIN` to the real address, both on the Worker and in the GitHub variable, and add it to the Supabase redirect allowlist and the Stripe webhook if you haven't already.
- [ ] Re-run step 7's owner checks on the real address.
- [ ] Set up a free uptime monitor (for example UptimeRobot) on `https://<new address>/api/health` every 5 minutes, alerting the owner's phone.
- [ ] Keep the old Sites site unpublished for two weeks as a fallback, then retire it.

## Rolling back

- **Before step 8:** nothing has changed for families. Fix and redeploy.
- **A bad publish:** Cloudflare → Workers → the worker → Deployments → roll back to the previous version. Database changes are add-only, so the previous version keeps working.
- **A data problem:** restore from the newest encrypted backup on `/backups`. Or decrypt the Deploy run's backup with `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in pre-deploy.sql.enc -out restore.sql -pass pass:<BACKUP_PASSPHRASE>` and import it into a new D1 database.
- **The new site is down after cut-over:** point the domain back to the old Sites site while it is fixed.

## Opening online payment later

Only after the matching decision is recorded on its issue:

1. Refund policy decided (#3): set `CHECKOUT_KINDS=walkin,event,live`.
2. Membership terms approved (#2): add `annual`, and later `monthly`.
3. Lesson refund policy decided (#80): add `lesson`.
4. Test with Stripe test cards first (#24), then follow the live steps on #26.
