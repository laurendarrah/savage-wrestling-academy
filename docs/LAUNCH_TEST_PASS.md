# Launch test pass (#24)

Justin and Lauren run this together on the live site, with Stripe in **test mode**, before any family joins. One of you plays the owner, the other a test family. Print it and tick each box as you go. Steps marked **Must pass** have to pass before families join; if one fails, stop and tell Lauren.

Write problems in the Notes column at the end of each section, then post the result on #24. Never write a real USA Wrestling card number, a family's details or a password on this page or on GitHub: the repository is public.

**Date:** ____________ **Owner:** ____________ **Test family:** ____________ **Site address:** ______________________________

## Before you start

- [ ] Signed in as the owner (`savagewrestlingclub@gmail.com`) with the password. The dashboard (`/`) shows the **Launch checklist**.
- [ ] **Online payment setup** (`/payment-setup`) says **Test mode only · No live charges** and **Connected to** the academy's Stripe account. If it says online payment stays closed until the webhook secret is added, finish `docs/GO_LIVE.md` step 6 first.
- [ ] Email works: **Site health → Alerts and email** says email is set up (Resend, #35), and Supabase sends sign-up emails through Resend (`docs/RUNBOOK.md`, "Sign-up or reset emails blocked by the email limit"). Without both, the email steps below can't pass.
- [ ] Online steps need their purchase type open in `CHECKOUT_KINDS` on the Worker. Each type opens only once its refund policy is decided (#3; memberships #2) and Justin approves it (`docs/GO_LIVE.md`, "Opening online payment later"). Steps marked **Online** run only for types that are open; do the rest now and the online ones when they open. The pass isn't finished until every online step for an open type has passed.
- [ ] A coach account that has accepted its invite (**Coaches**), for the practice steps.
- [ ] Today has an SWA Intermediate practice (or a practice in the test wrestler's program), Friday Night Live has a date, and a camp is on **Camps & events**.
- [ ] Two browsers or devices: one for the owner, one (or a private window) for the test family. A phone helps for the entry pass.
- [ ] A test email address you can read that isn't the owner's, for example a plus address like `yourname+swatest@gmail.com`.

Stripe test cards (Stripe's public test numbers; no real money moves): **4242 4242 4242 4242** pays, **4000 0000 0000 0002** is declined. Any future expiry date, any 3-digit CVC, any ZIP.

## 1. Owner setup is visible

In a private window, signed out:

- [ ] **Must pass.** `/welcome` lists **SWA Development**, **SWA Intermediate** and **SWA Advance** with their prices, says SWA Advance needs coach approval, and shows practices under **Coming up**. *If it says programs will be listed soon, publish them from the Launch checklist (**Publish the programs**).*
- [ ] **Must pass.** `/calendar` shows the week's practices, and **Camps & clinics** and **Extra practices** show the camp and Friday Night Live with their dates and times.
- [ ] **Must pass.** The SWA Intermediate practice days and times on `/calendar` match what Justin set under **Schedules** in the owner dashboard.
- [ ] Program cards on `/calendar?view=programs` show the prices set under **Programs & pricing**.
- [ ] The public website: `/welcome` shows the headline, introduction and mission from **Public website** (`/website`), and `/team` shows the coaches ticked there, with names only.
- [ ] A team code made under **Programs & pricing → Team codes** shows its discount on the review step of a monthly membership on `/register` (the test family can check this in section 2; online payment for memberships stays closed until #2).

Notes: ____________________________________________________________

## 2. A test family

In the family browser:

- [ ] **Must pass.** `/login` → **New here? Create an account** → the test email, a password, **Confirm password**. *You should see a message to check your email.*
- [ ] **Must pass.** The confirmation email arrives (from Supabase, sent through Resend) and its link opens the site signed in, on **Your family**. *Not there? Check spam, then `docs/RUNBOOK.md`, "Families say they never got the email".*
- [ ] **Must pass.** **Your family profile**: your name, phone number, street address, city, state, ZIP code and an emergency contact; **+ Add wrestler** with a name and grade, birth date, and **Allergies or medical notes** (or "None"). Try **Save family profile** with the address empty first. *It refuses until the required safety details are filled in, then says it's saved.*
- [ ] **Must pass.** Add a real USA Wrestling card: **USA Wrestling card number** and **Card season**, using a card that belongs to someone who has said you may use it for this test. The wrestler's name must match the name on the card. Never write the number down here. *You should see "USA Wrestling card verified · Checked with USA Wrestling on …". If it says it's waiting for the academy, the owner opens **USA Wrestling cards** (`/cards`) and chooses **Verified**.*
- [ ] **Must pass.** If a waiver is published (**Waivers**): the family page says the waiver isn't signed and links to it. Open it, draw a signature, tick both boxes and choose **Sign waiver**. *You should see "Signed for <wrestler>" and a **View / print** copy.* If no waiver is published yet (it waits for the attorney, #44), note that here.
- [ ] If the **Parent Consent Form** is published: sign it the same way on `/consent`. Otherwise note "not published".
- [ ] The owner sees the family on **Family accounts** (`/accounts`), with **Contact and safety details** filled in, and the card on `/cards`.

Notes: ____________________________________________________________

## 3. Purchases

Each purchase should show under **Purchases** on the family page, on **Payments** (`/payments`) for the owner, and on the right roster. Receipts: the site emails the family for anything recorded at the academy ("Payment received: …") and for every paid lesson ("Lesson booked: …", and "New lesson" to the coach). Stripe doesn't email receipts for test payments.

**Walk-in, paid online (Online: walkin)**
- [ ] **Must pass.** `/register` → **Walk-in** → program → a practice day and time → **Review selection →**. *The review shows the walk-in price ($40 unless changed).*
- [ ] Tick the terms box, **Continue to secure checkout**, and pay with **4000 0000 0000 0002**. *Stripe declines it and nothing is charged.* Then choose the back arrow on Stripe's page. *The family page says "Checkout canceled. Nothing was charged."*
- [ ] **Must pass.** Book it again and pay with **4242 4242 4242 4242**. *Back on the family page: "Payment confirmed", then the walk-in shows as paid under **Purchases**. The owner sees it on **Payments** as paid online, and the wrestler is on that practice's roster.*

**Walk-in, cash at the academy** (for today's practice, used again in section 4)
- [ ] **Must pass.** `/register` → **Walk-in** → today's practice → **Review selection →** → **Book and pay cash at the academy**. *You should see "Pay at the academy: $40.00 due". It shows on the family page and under **Cash due at the academy** on Payments.*
- [ ] The "Booked: …" email arrives.

**Friday Night Live**
- [ ] From `/calendar` → **Extra practices** (or the family page's **Book an extra practice, such as Friday Night Live →**), choose the date → **Review selection →**. **Online: live** — pay with 4242…; otherwise **Book and pay cash at the academy**. *It shows on the family page, and on that day's roster.*

**A camp**
- [ ] `/calendar` → **Coming up** or **Camps & clinics** → the camp → **Review selection →**. **Online: event** — pay with 4242…. Otherwise **Pay cash at the academy** → **Book and pay cash at the academy**. *You should see "Pay at the academy: $… due" with the camp's days; it shows on the family page, the camp's seats go down by one, and it is under **Cash due at the academy** on Payments. The owner taps **Cash received** there (coaches can't take camp cash). The family gets "Payment received: …" and sees it under Purchases.*
- [ ] Cancel a cash camp booking from the family page before the camp starts. *"Booking canceled: …" arrives under Messages, and the seat is free again.*

**A private lesson**
- [ ] The coach (on coach home, `/coach`) or the owner (**Coaches → Lesson openings**) adds an open time, and the owner has a price on **Private lesson prices**.
- [ ] `/lesson` → **Book a one-on-one** → the time. **Online: lesson** — **Pay securely** with 4242…. Otherwise choose **Tell the academy I want this**. *The page says "Sent." with the academy's address and email; the owner sees "Request from the website: a one-on-one lesson with …" under **Messages**. A second tap the same day says you already told the academy.* The owner then records it on Payments (**Paid for** a lesson, then the lesson). *The family gets "Lesson booked: …" and the coach gets "New lesson: …"; the coach sees "Booked" on coach home.*

**A partner lesson**
- [ ] With a partner price set, another open time, `/lesson` → **Start a private group** → **Partner** → the time → **Ask for this private group**. *Under **Your private groups**: the lesson, 1 of 2 spots left, the wrestler "Kept for you", and an invite link with **Copy link**. The coach sees "Family-requested private group".*
- [ ] Pay for the family's own spot: **Online: lesson** with 4242…, or the owner records it on Payments. *The emails above arrive.*

Notes: ____________________________________________________________

## 4. At practice

Today, with the test wrestler booked to pay cash (section 3):

- [ ] **Must pass.** The coach signs in with their password and opens **Roster & check-in** (`/roster`). *They see today's practices for their programs only, plus extra practices, with the test wrestler, their allergies or medical notes and emergency contact, and "$40.00 cash due". No family email addresses.*
- [ ] **Must pass.** The owner marks the test card **Not valid** on `/cards` (note: "Launch test"). On the coach's roster (choose **Refresh**): *the wrestler shows **Can't check in** with "can't be checked in: the academy marked the USA Wrestling card not valid (Launch test). Ask the family to update the card, or the owner to allow an exception."* The family also gets a "Please check … USA Wrestling card" email; that's expected. Then the owner chooses **Verified** on `/cards` again.
- [ ] **Must pass.** The coach chooses **Check in** for the wrestler. *It says they're checked in.* Try **Undo**, then **Check in** again.
- [ ] **Must pass.** The coach taps **Cash received** and confirms. *The row says "Received by <coach name> · <time>", and "Only the owner can undo cash". The owner sees it on **Payments** with **Collected by** the coach, and **Cash due at the academy** no longer lists it.*
- [ ] The "Payment received: …" email arrives for the family.
- [ ] The entry pass: the family opens **Entry pass** on the family page on a phone; the owner chooses **Scan a pass** on the roster and scans it. *It says already checked in.*

Notes: ____________________________________________________________

## 5. Money

- [ ] **Must pass.** In Stripe (test mode on) → **Payments** → the online walk-in → **Refund** → full amount. Within a minute or so, *Payments on the site shows it **Refunded**, the wrestler is off that practice's roster, and **Income and expenses** (`/financials`) shows the refund as money out.* Nothing changes? `docs/RUNBOOK.md`, "Stripe's notices aren't reaching the site".
- [ ] **Must pass.** **Income and expenses** → **Get fees from Stripe now**. *"Card processing fees" appears for the online payments. If it keeps saying payments are waiting for their fee, the restricted key needs Balance (read): `docs/RUNBOOK.md`, "Card fees are missing".*
- [ ] Payments → **Download spreadsheet** opens with the test payments, including **Collected by** for the cash one.

Notes: ____________________________________________________________

## 6. Messages

- [ ] **Must pass.** **Messages** (`/messages`) → **Send an announcement** → To **All families**, a subject and message → **Send announcement**. *It says it was sent. The test family sees it under **Announcements** on their Messages page, and the email arrives.*
- [ ] **Must pass.** The family writes under **Message the academy** and chooses **Send**. *The owner sees it under **Family messages**, opens it and replies with **Send to family**; the family sees the reply and gets the email.*
- [ ] **Emails that didn't go out** on Messages is empty, or each line has a reason you understand.

Notes: ____________________________________________________________

## 7. Safety

- [ ] **Must pass.** **Backups** (`/backups`) → a passphrase twice → **Encrypt & download backup**. *A `savage-backup-<date>.savage` file downloads.* Keep it and its passphrase for the restore drill (`docs/RESTORE_DRILL.md`, #25). It includes the test family; that's fine.
- [ ] **Must pass.** **Site health** (`/site-health`): **Right now** says the site and database are answering, and **Site errors in the last 7 days** has nothing from today you can't explain.
- [ ] The owner alert email: **Site health → Alerts and email** → **Send a test alert**. *The page says "Sent to savagewrestlingclub@gmail.com", and an email with the subject "Test alert: no action needed" and a link to Site health arrives in that inbox (check spam).* If the page says "Email isn't set up yet", email isn't set up (#35). Steps and failure reasons: `docs/RUNBOOK.md`, "Check that alert emails arrive" (#47).
- [ ] **Security activity** (`/security-log`) lists today's steps: the cash received, card reviews, the backup.

Notes: ____________________________________________________________

## 8. Cleanup: delete the test family

Do this the same day, after everything above. Payments are never deleted, because the books need them: they stay on Payments and Income and expenses with the family replaced by "Deleted family". So refund or void each test payment first, or it counts in the books.

- [ ] **Must pass.** In Stripe (test mode) → **Payments**: **Refund** every test card payment that isn't refunded yet. *Payments on the site shows each one **Refunded**.*
- [ ] **Must pass.** On **Payments**, **Void** every payment recorded at the academy for the test family (cash walk-in, cash Friday Night Live, recorded camp or lessons), with the reason "Launch test pass". *Each shows **Voided**, and **Income and expenses** no longer counts it.*
- [ ] On Payments → **Cash due at the academy**, **Cancel booking** for anything the test family still has due.
- [ ] Remove anything made only for the test: lesson openings nobody booked (coach home or **Coaches → Lesson openings**) and any test camp or event (**Camps & events**). A private group the test family started is opened up again when the family is deleted, once nothing on it is paid.
- [ ] **Must pass.** **Family accounts** (`/accounts`) → **Find a family** → the test family → **Delete this family account**. Tick **This is a test account** (so its signed waiver and forms and its check-ins go too), type the family's name exactly as shown, and choose **Delete this family account**. *You should see "Family account deleted", how many records were deleted and how many payments stay as "Deleted family". If it refuses, it says what is still going on (a paid session to come, a booking still due, a payment in progress): fix that and try again.*
- [ ] **Must pass.** Supabase → **Authentication → Users** → the test email → **Delete user**. The site can't remove a sign-in itself.
- [ ] **Security activity** shows "Family account deleted · A test account · … records deleted", with no name or email. `/accounts` no longer lists the family.

Good to know: Stripe keeps its test-mode records, which never appear in live mode or in the books once the site is live. The test announcement stays under **Sent announcements**. Restoring a backup made before this step (like the one from section 7) brings the test family back; delete it again afterwards.

Notes: ____________________________________________________________

## 9. Then: switch Stripe to live (#26)

Only after every **Must pass** step above has passed and the matching decisions are recorded:

- [ ] Follow `docs/GO_LIVE.md`, "Opening online payment later", and the live steps on #26: a live webhook (its secret in `STRIPE_LIVE_WEBHOOK_SECRET`), `STRIPE_MODE=live` on the Worker (Lauren, with Justin's approval), and a restricted `rk_live_` key from the same Stripe account on `/payment-setup`. *The page says **Live mode · Real charges**.*
- [ ] **Must pass.** One real, low-value purchase by staff with a real card (for example a walk-in or Friday Night Live for a staff member's own wrestler), then a full refund in Stripe (live mode). *The purchase and the refund show in Stripe, on Payments, on the family page and on Income and expenses.*
- [ ] Post the result on #24 and #26. Problems: `docs/RUNBOOK.md`, "Payments" and "Test or live?".
