# When something goes wrong

A plain guide for the owner and whoever helps run the site (issue #165). Work down the section that matches what you see. None of these steps needs a developer, a terminal or Claude.

Keep these four things in the password manager. Every fix below depends on at least one of them:
- The Cloudflare login (owner: Justin, admin: Lauren)
- The Supabase login (owner: Justin, admin: Lauren)
- The GitHub login with access to `laurendarrah/savage-wrestling-academy`
- `BACKUP_PASSPHRASE`, the passphrase that unlocks the automatic backups

## First, check site health

Sign in as the owner and open **/site-health**. It shows whether the site and database are answering, and every server error from the last 7 days with the page it happened on. If it loads, the site is up and the problem is narrower. Skip to the matching section below.

Set up a free uptime monitor (for example UptimeRobot) on `<site address>/api/health`, checking every 5 minutes and texting the owner's phone. Then you hear about an outage before families do.

Once email is set up (`EMAIL_API_KEY` and `MAIL_FROM`, #87), the site also emails the owner address when new server errors appear or the morning reminders don't finish, at most once an hour (#47). The email has counts, the page each problem was on and a link to **/site-health**, never family details. Problems that happen within the hour are in the next alert, which goes out with the next problem after the hour or with the next morning's scheduled run. **/site-health → Alerts and email** shows when the last alert went out, or why it didn't. An alert email can't help when the whole site is down, so keep the uptime monitor too.

## The site is down or shows an error for everyone

1. Open `<site address>/api/health`. If it says `"ok":true`, the site is up. The problem is probably the family's own connection or browser, so ask them to refresh or try another browser.
2. If it doesn't answer, check **Cloudflare → Workers & Pages → savage-wrestling-academy**. A banner there means a Cloudflare outage; also check cloudflarestatus.com. Nothing to do but wait.
3. If it broke right after an update, **roll back** (next section).

## An update made something worse

Every change goes live through GitHub's **Deploy** workflow, and only after the automatic checks pass. If one still causes a problem:

1. **Cloudflare → Workers & Pages → savage-wrestling-academy → Deployments.**
2. Find the version before the latest one and choose **Rollback**. The site is back on the old version within a minute.
3. Database changes are add-only, so the older version keeps working with the current data.
4. Tell whoever maintains the site what broke, and the time, so they can fix it and publish again.

## Data looks wrong or is missing

Don't make more changes until you know what happened.

1. Open **/security-log** for recent sign-ins, payments recorded, backups and other sensitive changes, with who made them and when.
2. To go back to an earlier copy, open **/backups → Restore**. Choose an encrypted backup file and enter its passphrase. This replaces the current data with the backup, so download a fresh backup first.
3. Where backups come from:
   - **Before every update**, Deploy saves an encrypted copy of the database. It's kept for 30 days: GitHub → **Actions → Deploy** → the run → **Artifacts** → `pre-deploy-database-<number>`. Unlock it with `BACKUP_PASSPHRASE`.
   - **Any time**, the owner can download one from **/backups**. Do this weekly and keep the file somewhere other than this computer.
4. A restore never brings back the records of a coach removed permanently more than 3 years ago: the site cleans them again straight after restoring, and the daily job does after a database is rebuilt from the Deploy backup. A file made before a coach was removed permanently brings them back as they were then; check **Coaches** afterwards (`docs/policies/data-retention-draft.md`, "When a coach is removed permanently").

## Families say they never got the email

- Announcements, private messages and automatic notices are always on the family's **Messages** page, emailed or not. If email isn't set up yet, **/messages** and **/site-health** say so.
- **/messages → Emails that didn't go out** lists each email from the last 30 days that didn't send: who it was for, when, what it was and why, in plain words. **Try again** sends it again. If the reason is the academy's email settings, check `EMAIL_API_KEY` and `MAIL_FROM` on the Worker and the sending domain in the email provider before trying again.
- Sign-up, confirmation and password emails come from Supabase. Until the academy chooses an email sender (#87), Supabase only delivers to people on the Supabase team, and only a few emails an hour. Families won't receive them until a sender is set up under **Supabase → Authentication → Emails → SMTP settings**.
- Check that the email links point at the site: **Supabase → Authentication → URL Configuration** lists the site address and the two `/auth/confirm` addresses (`docs/GO_LIVE.md`, step 6).
- The family can use **Didn't get the confirmation email?** on the sign-in page to send it again.

## Before families join: turn the authenticator back on

Until launch, the authenticator requirement can be off (`STAFF_MFA=off` on the Worker, issue #204), and the owner's launch checklist shows it in red. Before families join: **Cloudflare → Workers & Pages → savage-wrestling-academy → Settings → Variables and Secrets → delete `STAFF_MFA`**. The owner and coaches are then asked to set up an authenticator at their next sign-in.

## Someone lost the phone with their authenticator

**A coach or family:** the owner removes their access. For a coach, that's **Coaches (/staff) → remove**, then add them again so they set up a new authenticator. A family with an authenticator turned on needs the same reset as the owner, below.

**The owner:** a password reset alone won't get past the authenticator check.
1. If you added a backup authenticator (a second phone or a password manager), use it, then add a new one on **/security**.
2. If not, a Supabase admin (Lauren) opens **Supabase → Authentication → Users**, finds `savagewrestlingclub@gmail.com` and removes its MFA factors. If the dashboard doesn't offer that, Supabase support can do it. The owner then signs in and sets up a new authenticator.
3. Prevent this: right after setting up the first authenticator, add a backup one from **/security → Add a backup authenticator**.

## A payment looks wrong

- Online payments count only after Stripe confirms them. A family coming back from Stripe isn't proof of payment. If a family says they paid but it isn't on **/payments**, find the payment in the **Stripe dashboard**. If Stripe shows it paid, its notice to the site failed: **Stripe → Developers → Webhooks** → the site's endpoint → resend the event. The site safely ignores a repeated event.
- Cash, check or Venmo goes in with **/payments → Record an offline payment**. A mistake gets **Void**, not a second entry.
- Refunds happen in Stripe, and the site picks them up from Stripe's notice.

## Who to call

| Problem | Where it's fixed | Who has access |
|---|---|---|
| Site down or a bad update | Cloudflare | Justin (owner), Lauren (admin) |
| Sign-in, emails, authenticators | Supabase | Justin (owner), Lauren (admin) |
| Payments and refunds | Stripe | Justin |
| The site's code and publishing | GitHub | Lauren |
| Domain and email for savagewrestling.com | GoDaddy | Justin |
