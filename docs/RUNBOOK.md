# When something goes wrong

A plain guide for the owner and whoever helps run the site (issues #165 and #47). Find the section that matches what you see and work down it. Most steps need no developer, terminal or Claude. Where one does, the section says who to ask.

Keep these six things in the password manager. Every fix below depends on at least one of them:
- The Cloudflare login (owner: Justin, admin: Lauren)
- The Supabase login (owner: Justin, admin: Lauren)
- The Stripe login (Justin's own account, #4)
- The Resend login for email (Justin's own account; Lauren helps only if asked)
- The GitHub login with access to `laurendarrah/savage-wrestling-academy`
- `BACKUP_PASSPHRASE`, the passphrase that unlocks the automatic backups

**Contents**
- [First, check site health](#first-check-site-health)
- Site and updates: [site down](#the-site-is-down-or-shows-an-error-for-everyone) · [a deploy failed](#a-deploy-failed) · [GitHub Actions isn't running](#github-actions-isnt-running) · [roll back a bad update](#an-update-made-something-worse) · [data wrong or missing](#data-looks-wrong-or-is-missing)
- Payments: [connecting Stripe](#connecting-the-academys-stripe-account) · [Stripe's notices aren't reaching the site](#stripes-notices-arent-reaching-the-site) · ["my payment didn't go through"](#a-family-says-their-payment-didnt-go-through) · [charged but unpaid](#a-family-was-charged-but-the-payment-shows-unpaid) · [a monthly payment failed](#a-monthly-payment-failed) · [refunds](#refunds) · [card fees missing](#card-fees-are-missing) · [test or live?](#test-or-live) · [offline payments](#offline-payments)
- Sign-in: [nobody can sign in](#nobody-can-sign-in-or-sign-up) · [email limit reached](#sign-up-or-reset-emails-blocked-by-the-email-limit) · [the authenticator switch](#the-authenticator-switch-staff_mfa) · [lost authenticator](#someone-lost-the-phone-with-their-authenticator) · [owner locked out](#the-owner-is-locked-out)
- Email: [families never got the email](#families-say-they-never-got-the-email) · [check alert emails arrive](#check-that-alert-emails-arrive)
- [Who to call](#who-to-call)
- Before launch: [the launch test pass](LAUNCH_TEST_PASS.md) (#24) · [the restore drill](RESTORE_DRILL.md) (#25)

## First, check site health

Sign in as the owner and open **/site-health**. It shows whether the site and database are answering, whether the sign-in service (Supabase) answers, when the morning reminders last ran, the build the site is running, and every server error from the last 7 days with the page it happened on, who was signed in (owner, coach, family or nobody) and a reference. If it loads, the site is up and the problem is narrower. Skip to the matching section below.

**References.** Since #274, when a page cannot finish a request it shows "Something went wrong. Try again. (reference 3f2a1b4c)". The reference is the last column of the error list on **/site-health**, so a family or coach only has to read it to you and you can find the exact error. The message itself never includes what they typed or their email.

Set up a free uptime monitor (for example UptimeRobot) on `<site address>/api/health`, checking every 5 minutes and texting the owner's phone. Then you hear about an outage before families do.

Once email is set up (`EMAIL_API_KEY` and `MAIL_FROM`, #87), the site also emails the owner address when new server errors appear, the morning reminders don't finish, or a morning's reminders had not run by 10 AM New York (the site then runs them from the next page visit, #274), at most once an hour (#47). The email has counts, the page each problem was on and a link to **/site-health**, never family details. Problems that happen within the hour are in the next alert, which goes out with the next problem after the hour or with the next morning's scheduled run. **/site-health → Alerts and email** shows when the last alert went out, or why it didn't. An alert email can't help when the whole site or the email service is down, so keep the uptime monitor too. To check alert emails reach the owner without waiting for a real problem, use **Send a test alert** ([below](#check-that-alert-emails-arrive)).

## The site is down or shows an error for everyone

1. Open `<site address>/api/health`. If it says `"ok":true`, the site is up. The problem is probably the family's own connection or browser, so ask them to refresh or try another browser.
2. If it doesn't answer, check **Cloudflare → Workers & Pages → savage-wrestling-academy**. A banner there means a Cloudflare outage; also check cloudflarestatus.com. Nothing to do but wait.
3. If it broke right after an update, **roll back** ([below](#an-update-made-something-worse)).

`/api/health` checks the site and its database, and says which build is running, when the scheduled run last ran and whether email, sign-in and the Stripe webhook are set up (yes or no, never the values). Sign-in (Supabase), payments (Stripe) and email can still be down while it says `"ok":true`; they have their own sections. **/site-health** does check that the sign-in service answers.

## A deploy failed

**You see:** a red **Deploy** run in GitHub → **Actions**, or a change that was merged but isn't on the site.

**Where to look:** GitHub → **Actions → Deploy** → the red run. The step with the red cross is where it stopped.

**What Deploy does, in order.** Each step runs only if the one before it worked:
1. **Check settings:** the GitHub secrets and variables exist. "Missing ..." means one was deleted or renamed.
2. **Install** and **Build** the site.
3. **Back up** the live database, encrypted, and keep it for 30 days.
4. **Apply database migrations** (new tables and columns).
5. **Publish** the new version.
6. **Check the live site answers** at `/api/health`.

**What it means for families:**
- **Stopped at steps 1 to 5:** the live site is still on the previous version, and families notice nothing. If it stopped at step 5, the database changes from step 4 stay. They only ever add things, so the previous version keeps working with them.
- **Stopped at step 6:** the new version **is** live but didn't answer. Open `<site address>/api/health` yourself. If it doesn't answer, [roll back](#an-update-made-something-worse) now, then report it.

**What to do:**
1. Send Lauren the link to the red run.
2. If the failure looks temporary (a Cloudflare or GitHub outage, a timeout), Lauren can choose **Re-run failed jobs** on the run. A re-run backs up again first, so it is safe.
3. Otherwise Lauren fixes it in a pull request. Merging it starts a new Deploy.
4. Never publish from a computer to get around a failed Deploy. Production is published only by the Deploy workflow.

**Worked example (Nov 7, #228).** After a tooling upgrade, Deploy stopped at "Apply database migrations" with "No migrations present". The upgraded build tool had started reading the migrations folder setting differently, so Deploy looked for the migrations in the wrong place. The backup had run; nothing was migrated or published, and the live site stayed on the previous version. A one-line fix to that setting went through a normal pull request, and the next Deploy published.

**Who:** Lauren (GitHub and the code). Justin only if the site is down after step 6, to roll back in Cloudflare.

## GitHub Actions isn't running

**You see:** a pull request whose checks stay "Queued" or "Waiting" or never appear, or a merge to `main` that never starts a **Deploy** run.

**Where to look:**
- GitHub → **Actions**. A yellow or red banner about billing, payments or a spending limit means GitHub has stopped running jobs for the account.
- githubstatus.com for a GitHub outage (nothing to do but wait).
- Repository → **Settings → Actions → General**: Actions must be allowed.

**What to do:**
1. **A billing or minutes banner:** the account that owns the repository (laurendarrah) fixes it under GitHub → **Settings → Billing and plans** (payment method or spending limit).
2. **After it runs again:** open each waiting pull request and choose **Re-run all jobs** on its checks, or push a new commit.
3. **Merges made while it was stopped aren't published yet.** Deploy starts only after the **Checks** run on `main` passes. Re-run the latest **Checks** run on `main`; when it passes, Deploy starts by itself. If it doesn't, use **Actions → Deploy → Run workflow**, but only once Checks on `main` is green: a run started by hand doesn't wait for checks.

**Worked example (Nov 7).** Checks stopped starting while the repository was private, because the account's GitHub Actions minutes or billing ran out. The repository is now public. GitHub doesn't charge for its standard runners on public repositories, so this shouldn't happen again unless the repository is made private.

**Who:** Lauren (the GitHub account and billing).

## An update made something worse

Every change goes live through GitHub's **Deploy** workflow, and only after the automatic checks pass. If one still causes a problem:

1. **Cloudflare → Workers & Pages → savage-wrestling-academy → Deployments.**
2. Find the version before the latest one and choose **Rollback**. The site is back on the old version within a minute.
3. Database changes are add-only, so the older version keeps working with the current data.
4. Tell whoever maintains the site what broke, and the time, so they can fix it and publish again.

A Cloudflare rollback lasts only until the next Deploy, which publishes `main` again, bad change included. To undo the change for good, Lauren opens the merged pull request on GitHub and chooses **Revert**. That makes a new pull request; it goes through checks, review and Deploy like any other.

## Data looks wrong or is missing

Don't make more changes until you know what happened.

1. Open **/security-log** for recent sign-ins, payments recorded, backups and other sensitive changes, with who made them and when.
2. To go back to an earlier copy, open **/backups → Restore**. To check a file first without touching the live site, restore it into a local copy ([the restore drill](RESTORE_DRILL.md)). Choose an encrypted backup file and enter its passphrase. This replaces the current data with the backup, so download a fresh backup first.
3. Where backups come from:
   - **Before every update**, Deploy saves an encrypted copy of the database. It's kept for 30 days: GitHub → **Actions → Deploy** → the run → **Artifacts** → `pre-deploy-database-<number>`. Unlock it with `BACKUP_PASSPHRASE`.
   - **Any time**, the owner can download one from **/backups**. Do this weekly and keep the file somewhere other than this computer.
4. A restore never brings back the records of a coach removed permanently more than 3 years ago: the site cleans them again straight after restoring, and the daily job does after a database is rebuilt from the Deploy backup. A file made before a coach was removed permanently brings them back as they were then; check **Coaches** afterwards (`docs/policies/data-retention-draft.md`, "When a coach is removed permanently").

## Payments

An online payment counts as paid **only** when Stripe sends the site a signed notice (a "webhook") saying so. A family coming back from Stripe, a receipt, or a screenshot is not proof, and nothing on the site marks a card payment paid by hand. So when Stripe's notices don't arrive, payments look unpaid even though the money moved.

The Stripe account is Justin's: he created it and owns it, its payouts and its keys (#4). Lauren helps only if he asks.

### Connecting the academy's Stripe account

**/payment-setup** shows "Connected to <account name> (acct_…)" once a test key is saved. No account is built into the site: the first test key decides it (issue #255).

- **Connecting for the first time:** create a restricted test key in Stripe (the page lists the steps and permissions), paste it and choose **Verify test key**. The page shows the account the key belongs to. Check the name and id, then choose **Yes, connect this account**. Security activity shows "Stripe account connected".
- **"This key belongs to a different Stripe account":** the key comes from another Stripe account than the one the site is connected to. Make the key in the connected account (the error names both). If the academy really is moving to another Stripe account, choose **Connect a different Stripe account** and confirm, then paste the new account's key. That removes the saved key and forgets the old account (Security activity shows "Stripe account disconnected"). Online card payments stop until the new key is saved, and the new account needs its own webhook (`docs/GO_LIVE.md`, step 6).
- **"Save your test key first so the site knows your Stripe account":** a live key was pasted before any test key connected the account. Save and confirm the test key first, from the same Stripe account.
- **"The Stripe account saved in the site's settings is not a valid account id":** someone set `STRIPE_ACCOUNT_ID` on the Worker to something that isn't an `acct_…` id. Fix or delete it in Cloudflare → the worker → Settings → Variables and secrets. While it is set, it decides the account, and the page can't switch accounts.
- **Connect a different Stripe account is missing:** the site is in live mode, or `STRIPE_ACCOUNT_ID` is set. Changing accounts while taking real payments is deliberately not possible from the page.

**Who:** Justin (Stripe and `/payment-setup`). Lauren only if asked.

### Stripe's notices aren't reaching the site

**You see:** families say they paid but **/payments** shows nothing new, or "Not finished". Stripe may email the account about failed webhook deliveries. **/site-health** may list errors on `/api/stripe-webhook`.

**Where to look:**
1. **Stripe → Developers → Webhooks** → the endpoint ending in `/api/stripe-webhook`. Make sure you are in the right mode (see [Test or live?](#test-or-live)). It shows each delivery and whether the site accepted it.
2. **/site-health:** errors on `/api/stripe-webhook` mean the site received the notice but couldn't finish it.
3. **/security-log:** "Stripe message refused" means the site received the notice and deliberately refused it, with the reason.

**What to do, by what Stripe shows:**
- **Status 400 ("Invalid signature"):** the signing secret on the site doesn't match this endpoint. Copy the endpoint's **Signing secret** from Stripe and put it in `STRIPE_TEST_WEBHOOK_SECRET` (or `STRIPE_LIVE_WEBHOOK_SECRET` in live mode) on the Worker: Cloudflare → the worker → Settings → Variables and secrets. Ask Lauren if you want help. These don't show on /site-health.
- **Status 503 ("Webhook not configured"):** no signing secret is saved on the Worker at all. Same fix.
- **Status 500, or timeouts:** the site couldn't process it. Stripe tries again by itself, for up to 3 days in live mode and a few times over a few hours in test mode. Check /site-health and send Lauren the time.
- **Endpoint shows Disabled:** Stripe turns an endpoint off after days of failures. Turn it back on in Stripe once the cause is fixed.
- **Events missing entirely:** the endpoint must listen for `checkout.session.*`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `charge.dispute.closed`, `invoice.paid`, `invoice.payment_failed` and `customer.subscription.deleted` (`docs/GO_LIVE.md`, step 6).

**Once the cause is fixed, resend what failed:** on the endpoint's page, open each failed event and choose **Resend**. Resending is always safe: the site stores each Stripe event once and ignores a repeat, so nothing is counted twice.

**Who:** Justin (Stripe dashboard and the Worker's Stripe settings). Lauren helps if asked, for example with errors on /site-health.

### A family says their payment didn't go through

**Where to look:** **/payments → Payment attempts**, at the bottom of the page (#271). It lists every online checkout a family started in the last 90 days, newest first, with the last thing Stripe said about it in plain words. Type the family's name or email in **Find a family**.

**What each line means:**
- **Not finished:** the family opened checkout and Stripe has said nothing yet. If it is more than an hour old, they closed the Stripe page without paying. Nothing was charged; they can try again from their family account.
- **Closed:** the checkout expired or was replaced by a newer one. Nothing was charged.
- **Failed:** Stripe could not take the payment (a declined card, for example). Nothing was charged; they can try again.
- **Paid / Refunded:** what it says. If the family thinks they paid but the line says otherwise, check Stripe (search the session id shown on the line) and follow [charged but unpaid](#a-family-was-charged-but-the-payment-shows-unpaid).
- **Refused:** Stripe sent a message the site would not apply, with the reason (the same reason is on /security-log as "Stripe message refused"). Do what the reason says: "The same purchase was paid twice" or "A payment came after all 12 were made" means refund that one payment in Stripe; "Test and live payments were mixed up" means a test payment reached the live site, or the reverse; "It named an order the site does not have" means a Stripe payment that did not start on this site.

Every refused message also goes to the owner in the hourly alert email, once email is set up (#47), under "Payment messages from Stripe the site refused".

**Who:** Justin (Stripe). Ask Lauren if a line says "Refused" and the reason isn't one of the above.

### A monthly payment failed

A membership is a monthly card payment at Stripe that renews until canceled (#20; month to month since Nov 13, #2, #314). When one fails (#271):
- The family gets a notice ("Payment needs attention") and the owner an email. Stripe retries the card by itself over the next days, and each retry that fails sends another notice.
- **/payments → Payment needs attention** (and the dashboard tile of the same name) lists every membership in this state, with the paid-through day and the day the wrestler comes off the roster.
- **The grace:** the wrestler stays on the roster for **7 days after the paid-through day** while Stripe retries. A payment covers through the next billing day itself, so a member is never off the roster on billing-day morning. Once a retry goes through, access runs to the next billing day as usual.
- **If Stripe gives up** and cancels the subscription, the membership **pauses** (#313): the wrestler comes off the roster after the paid-through day (the grace stops), nothing more is charged, and the family and the owner are told. The family restarts it with **Restart membership** on their account: a new monthly payment from that day, with no back pay for the missed months. /payments shows the membership as "Paused".
- **A family asks to cancel** by email, phone or in person: on /payments → All payments, find the membership and choose **Cancel membership**. No more charges; the wrestler stays on the roster through the paid-through day, and the family gets an email. Cancel there rather than in Stripe, so the family is told straight away.
- **To settle it by hand:** take the payment in Stripe (Customers → the subscription → pay the open invoice, or update the card), or talk to the family. Don't record a card payment as an offline payment; Stripe's own notice counts it.
- **A payment for a different amount** (a coupon or a price you changed in Stripe) still counts, for the amount Stripe collected: the books show that amount, /security-log says "Monthly payment for a different amount", and the owner gets an email to check it was meant.

**Who:** Justin (Stripe and the family). Lauren only if asked.

### A family was charged but the payment shows unpaid

**You see:** a family has a charge on their card or a Stripe receipt, but **/payments** doesn't show it as paid.

**Where to look:** find the payment in **Stripe → Payments** (search by the family's email). Check it says **Succeeded** and that you are in live mode, not test mode.

**What to do:**
1. **Stripe shows it Succeeded:** its notice didn't reach the site. In **Stripe → Developers → Webhooks** → the site's endpoint, find the failed `checkout.session.completed` delivery from around that time and choose **Resend**. It then shows as paid on /payments, the family's page and the roster. If it's still unpaid, follow [Stripe's notices aren't reaching the site](#stripes-notices-arent-reaching-the-site).
2. **/security-log shows "Stripe message refused":** do what the reason says. "The same purchase was paid twice" or "A payment came after all 12 were made" means refund that one payment in Stripe. "Test and live payments were mixed up" means a test payment reached the live site, or the reverse.
3. **/security-log shows "Event paid over its seat limit":** the payment counted, but the event is now over its seats. Refund one family in Stripe or make room.
4. **Stripe shows Incomplete, or no payment at all:** the family didn't finish paying, and no money moved. Under **Payment attempts** on /payments it shows "Not finished" or "Closed". They can start again.
5. **Don't record a card payment with "Record an offline payment".** It would count the money twice, and Stripe's real notice would then be refused as a double payment.

**Who:** Justin (Stripe). Ask Lauren if resending doesn't fix it.

### Refunds

Refunds happen in Stripe, never on the site: **Stripe → Payments** → the payment → **Refund**, then choose the full amount or a smaller one. The site picks it up from Stripe's notice within a minute or so.

- **Partial refund:** the payment stays paid (the wrestler keeps their place). **/payments** shows "refunded so far", and **/financials** counts it as money out on the day of the refund.
- **Full refund of a one-time payment:** marked refunded on /payments, and the wrestler comes off that roster.
- **One month of a monthly membership:** recorded as money out, but the membership continues. To end it, cancel the subscription in Stripe; the membership then ends on its paid-through day and the family is told (see [a monthly payment failed](#a-monthly-payment-failed)).
- **A refund doesn't show on the site:** follow [Stripe's notices aren't reaching the site](#stripes-notices-arent-reaching-the-site) and resend the `charge.refunded` event.

### A family disputed a card payment (chargeback)

**You see:** an alert email "a family disputed a card payment", a line on **/site-health**, "Card payment disputed by the family's bank" on **/security-log**, and the payment marked **Disputed** on **/payments**. Stripe also emails the account.

**What it means:** the family asked their bank to reverse the charge. The bank takes the money from the Stripe balance while the dispute is open, and Stripe charges a dispute fee. The site keeps the payment as paid (the wrestler keeps their place) and **/financials** books the money out on the day the bank took it, under "Disputed payments".

**What to do:**
1. In **Stripe → Payments → Disputes**, open the dispute and read the reason and the deadline.
2. Talk to the family: a dispute is often a charge they didn't recognise. If they agree the charge was right, they can ask their bank to withdraw it.
3. Answer in Stripe before the deadline with evidence (the booking on /payments, the family's account, the signed waiver, check-ins on the roster). A dispute not answered in time is lost.
4. If Stripe says the academy won, the money comes back; the site books it in under "Disputes won" and the payment says **Dispute won**. If lost, the payment says **Dispute lost**; refund nothing (the bank already took it). Enter Stripe's dispute fee on /financials as an expense.
5. A dispute of one monthly payment doesn't end the membership on the site. To end it, cancel the subscription in Stripe.

**Who:** Justin (Stripe and the family). Lauren helps if asked.

### Card fees are missing

Stripe's card fees reach **/financials** (as "Card processing fees") and the **/payments** spreadsheet the day after a payment, or straight away with **/financials → Get fees from Stripe now**. Marking a payment paid never waits for its fee.

If the page keeps saying payments are waiting for their fee, or **/site-health** shows "Reading card fees from Stripe" failing, the restricted Stripe key is missing the **Balance (read)** permission. In Stripe, edit the key (**Developers → API keys**), allow Balance read, and save. The key itself doesn't change, so nothing needs re-entering on the site.

### Test or live?

The site and Stripe each have a test mode and a live mode, and they never mix.

- **Which mode is the site in?** **/payment-setup** says "Test mode only · No live charges" or "Live mode · Real charges". It is in test mode unless `STRIPE_MODE=live` is set on the Worker.
- **Can't find a payment in Stripe?** Check the test mode switch in the Stripe dashboard. Test payments only show in test mode, and real ones only in live mode.
- **A family's real card is declined with a message about test mode:** the site is still in test mode, and no money moved. Online payment isn't live yet.
- **A test-card payment (4242 ...) succeeded on the live site:** it can't. In live mode the site only uses the live key, and a notice signed for the wrong mode is refused ("Test and live payments were mixed up" in /security-log).
- **/financials** counts card payments of the mode the site is in now. Test payments made before going live don't appear there afterwards.
- Keys start `rk_test_` or `rk_live_`. /payment-setup only accepts the key for the mode the site is in, and only from the connected Stripe account.

**Switching to live** is a deliberate, one-time step, and only after the matching decisions are recorded: follow `docs/GO_LIVE.md` → "Opening online payment later" and the live steps on #26. To stop online payment at once in an emergency, the owner can have Lauren delete `CHECKOUT_KINDS` on the Worker: every online checkout closes, and families see how to pay the academy directly. Payments already made are unaffected.

### Offline payments

Cash, check or Venmo goes in with **/payments → Record an offline payment**. A mistake gets **Void**, not a second entry.

## Sign-in

Sign-in, sign-up, confirmation and password emails, and authenticators all run on Supabase. The rest of the site runs on Cloudflare, so `/api/health` can say `"ok":true` while nobody can sign in.

### Nobody can sign in or sign up

**You see:** several people (not just one family) get "Unable to ..." or "could not finish" messages on the sign-in page.

**Where to look:**
1. status.supabase.com for a Supabase outage.
2. **Supabase → the project's home page.** If it says the project is paused, choose **Restore project**.
3. **/site-health** for errors on `/api/auth` or `/login`.

**What to do:**
- **A Supabase outage:** nothing to do but wait. Signed-in pages say "Sign-in is temporarily unavailable" (#274): nobody is signed out, and **/site-health** counts these outages and shows whether Supabase answers right now. Tell families on your usual channel that sign-in is down and that nothing is lost. Staff can't sign in either, so if it runs into a practice, take attendance on paper.
- **One person sees "Too many attempts":** they wait a minute and try again. Each email address gets 10 sign-in tries a minute and 30 an hour; a shared network (the academy WiFi) gets 30 a minute across everyone (#274). Password resets, sign-ups and confirmation emails have their own limits, so sign-in attempts never use them up.
- **Everything looks fine in Supabase but nobody can sign in:** send Lauren the time and what the page said.

**Who:** Justin or Lauren (Supabase). Supabase support from the dashboard if the project won't restore.

### Sign-up or reset emails blocked by the email limit

**You see:** "Email limit reached. Please wait before trying again." when creating an account, or "Email sending is temporarily limited" when asking for a reset or a new confirmation email.

**Why:** until a custom email sender is set up, Supabase uses its own built-in sender, which delivers only to members of the Supabase project team, a few emails an hour. On Nov 6 this blocked Justin's first sign-up on the new site.

**The fix:** connect a real email sender to Supabase. The site's own email already uses Resend (the provider choice is recorded on #87). In **Supabase → Authentication → Emails → SMTP Settings**, turn on custom SMTP and enter Resend's SMTP details: host `smtp.resend.com`, port `465`, username `resend`, and a Resend API key as the password, kept in the password manager and never in a document. The sender address must be on a domain verified in Resend. Afterwards, check **Supabase → Authentication → Rate Limits** allows enough emails an hour for sign-up nights.

**The workaround, for one person, today:**
1. **Supabase → Authentication → Users → Add user → Create new user.**
2. Enter their email and a temporary password, and tick **Auto Confirm User**. If Supabase says the email is already registered and the user shows "Waiting for verification", delete that unconfirmed user first (they never signed in, so nothing is lost), then create it again.
3. Give them the temporary password in person or by phone. They sign in, then change it from **/security → Change password**.
4. The owner account works this way too: the site recognises the owner by the confirmed owner email address.

**Who:** Justin or Lauren (Supabase), Justin (Resend, his own account; Lauren helps only if asked).

### The authenticator switch (STAFF_MFA)

The owner and coaches sign in with email and password only. Lauren and Justin decided this on Nov 13 (#306), replacing the earlier plan to require an authenticator before families join (#27).

- **Default:** no `STAFF_MFA` setting means no authenticator is required. A deploy can't change that.
- **Someone is still asked for a code:** they set up an authenticator at some point, and it stays in use. In **Supabase → Authentication → Users**, open their account and delete its **MFA factors**. They then sign in with their password only.
- **To require authenticators again:** add `STAFF_MFA` with the value `on` in Cloudflare (**Workers & Pages → savage-wrestling-academy → Settings → Variables and Secrets**), as a **Secret**. The owner and coaches are then asked to set one up at their next sign-in.

### Someone lost the phone with their authenticator

**A coach or family:** the owner removes their access. For a coach, that's **Coaches (/staff) → remove**, then add them again so they set up a new authenticator. A family with an authenticator turned on needs the same reset as the owner, below.

**The owner:** a password reset alone won't get past the authenticator check.
1. If you added a backup authenticator (a second phone or a password manager), use it, then add a new one on **/security**.
2. If not, a Supabase admin (Lauren) opens **Supabase → Authentication → Users**, finds `savagewrestlingclub@gmail.com` and removes its MFA factors. If the dashboard doesn't offer that, Supabase support can do it. The owner then signs in and sets up a new authenticator.
3. Prevent this: right after setting up the first authenticator, add a backup one from **/security → Add a backup authenticator**.

### The owner is locked out

Work down this list:
1. **Wrong account:** the owner is only `savagewrestlingclub@gmail.com`. Signed in with another email, the site shows a family account. Sign out and sign in with the owner email.
2. **Forgot the password:** **/login → Forgot your password?** Open the reset link in the same browser you asked from. If the reset email doesn't arrive, see [the email limit](#sign-up-or-reset-emails-blocked-by-the-email-limit).
3. **Email never confirmed:** **/login → Didn't get the confirmation email?** If that is blocked too, a Supabase admin uses the workaround above.
4. **"Too many sign-in attempts":** wait a minute.
5. **Lost authenticator:** see [the section above](#someone-lost-the-phone-with-their-authenticator).
6. **Can't get into Supabase itself** (needed for 3 and 5): Lauren is a Supabase admin and can do those steps. If neither of you can sign in to Supabase, contact Supabase support.

**Who:** Lauren (Supabase admin) for anything past step 4.

## Families say they never got the email

**First, it's never lost.** Announcements, private messages and automatic notices are always on the family's **Messages** page, emailed or not.

**Where to look:**
- **/messages → Emails that didn't go out** lists each email from the last 30 days that didn't send: who it was for, when, what it was and why, in plain words.
- **/site-health → Alerts and email** shows whether email is set up and how many family emails didn't send.
- If email isn't set up at all, both pages say "Email isn't set up yet, so families aren't getting emails", and the **Try again** buttons are hidden until it is.

**What to do, by the reason shown:**
- **"Too many emails went out at once" or "couldn't be reached":** the email service (Resend) was busy or down. Wait a while, then choose **Try again**, or **Try all again** for the whole list.
- **"didn't accept the academy's email settings":** the sending key or address is wrong or was revoked. Justin checks `EMAIL_API_KEY` and `MAIL_FROM` on the Worker (Cloudflare → the worker → Settings → Variables and secrets) and that the sending domain is still verified in his Resend account, then you choose **Try again**. Lauren helps if asked.
- **"refused the message":** the address may be mistyped. Check it with the family.
- **While email is down, the site can't email you about problems either.** Check **/site-health** yourself.

**Sign-up, confirmation and password emails** don't come from the site: Supabase sends them. If only those are missing, see [the email limit](#sign-up-or-reset-emails-blocked-by-the-email-limit). Also check that the email links point at the site: **Supabase → Authentication → URL Configuration** lists the site address and the two `/auth/confirm` addresses (`docs/GO_LIVE.md`, step 6). The family can use **Didn't get the confirmation email?** on the sign-in page to send it again.

**Who:** Justin (Resend, his own account, and the Worker's email settings). Lauren helps only if asked.

### Check that alert emails arrive

Do this once email is set up (#35), and again whenever `EMAIL_API_KEY`, `MAIL_FROM` or the Resend account changes (#47, #263).

1. Sign in as the owner and open **/site-health**.
2. Under **Alerts and email**, choose **Send a test alert**. One email goes to the owner address (`savagewrestlingclub@gmail.com`) through the same path as real alerts, with the subject "Test alert: no action needed" and a link back to **/site-health**.
3. The page answers in plain words:
   - **"Sent to …"**: the email service accepted it. Check that inbox within a few minutes, and the spam folder. If it's in spam, mark it "not spam" so real alerts land in the inbox.
   - **"Email isn't set up yet"**: `EMAIL_API_KEY` or `MAIL_FROM` is missing on the Worker. Nothing was sent. Set up email first (see above).
   - **"The test alert didn't send"** with a reason: the same reasons as above (settings not accepted, refused, busy, unreachable), and the same fixes.

You can send 3 test alerts an hour. Each one is in **Security activity** ("Test alert from Site health", with whether it sent). A test alert never changes when the next real alert can go out, and it isn't counted as one: **Alerts and email** still shows the last real alert.

**Who:** Justin, with the owner's inbox. Lauren helps only if asked.

## Who to call

| Problem | Where it's fixed | Who has access |
|---|---|---|
| Site down or a bad update | Cloudflare | Justin (owner), Lauren (admin) |
| A failed deploy, GitHub Actions, the site's code | GitHub | Lauren |
| Sign-in, sign-up emails, authenticators | Supabase | Justin (owner), Lauren (admin) |
| Payments, refunds, webhooks, connecting Stripe | Stripe (Justin's own account), plus `/payment-setup` | Justin. Lauren only if asked |
| Emails from the site to families and the owner | Resend (Justin's own account), plus Worker settings in Cloudflare | Justin. Lauren only if asked |
| Domain and email for savagewrestling.com | GoDaddy | Justin |
