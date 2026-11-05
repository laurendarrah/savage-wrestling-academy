# User workflows

## Account creation, login and recovery

The login page sends JSON actions to `/api/auth`. Signup validates email and password length, applies rate limits, calls Supabase signUp, and requests email confirmation. A confirmation callback exchanges the code or verifies the token hash, sets cookies, and redirects to login. Login verifies the password in Supabase, derives a role from the verified email or current staff record, and routes to owner, coach or family pages. Owner/coach and enrolled family MFA flows go through `/security` and `/api/security`.

Password recovery calls Supabase resetPasswordForEmail and later updateUser. Both the signup and recovery email destination use the old hard-coded APP_ORIGIN, so verify and correct that configuration before live recovery testing. Existing password login does not exercise the email callback path.

## Saving a family

`/family` loads `/api/family`. The server derives the account ID from the Supabase session. The parent saves contact fields and one or more wrestler records. PUT validates the data and expected revision, then inserts or updates only that account. Conflicting changes return 409. A wrestler with an active scholarship cannot be removed while that entitlement remains active. Saving a profile does not purchase a membership or sign a waiver.

## Paid membership or walk-in review

The public calendar links into `/register`, with optional program, plan and date parameters. The page loads the authenticated family, a server-generated catalog and approval state. The parent chooses a saved wrestler and one of three plans. Monthly means 12 installments over 12 months; annual means a one-time upfront 12-month term. Walk-ins require a specific saved date/time. Legacy monthly query links now select the installment plan.

POST `/api/registration` validates session ownership, grade, the SWA Advance approval, current program price, any team code, and selected practice. It blocks a duplicate same-program review when a real active scholarship already covers the wrestler. It returns a review with amount, payment count, term, total commitment and draft terms. The response always marks payments disabled. No paid enrollment, invoice, capacity hold, subscription or receipt is created.

## Approval and conversation

A parent requests approval for a saved wrestler through `/api/program-approvals`. The owner reviews at `/approvals` through `/api/owner-approvals`. Server checks bind the request to the parent, wrestler ID, name and grade, and owner decisions reject stale revisions. Approval chat is a separate authenticated D1 conversation. Browser polling refreshes it every 15 seconds while visible. Approval permits registration review; it does not create paid access.

## Owner scheduling and public calendar

Owner settings load from `/api/academy`. Creating a semester or named practice changes the in-memory owner document and queues a revisioned PUT. A successful save updates D1; public projections subsequently read that state. Daily practice generation chooses the latest matching semester for each program and removes excluded days. Public calendar views always show all programs. Named practices have selected dates and separate prices. Event definitions include dates, type, price, optional single-day camp price, description, grade guidance and slot count.

Up next is built from saved owner-state schedules and upcoming offerings. This fixes the prior fixed October examples, but it is still a view of the current loaded workspace and is not a realtime subscription to another device's changes.

## Camps, clinics, added practices and lessons

`/booking` submits a saved wrestler and offering selection to `/api/booking-review`. The server verifies the live offering and date. A real active scholarship qualifies for the saved member practice price and a 10% Camp review discount. Paid member status is not available yet. A full event is blocked from review, but no transactional reservation or payment is made. Private lesson review verifies a format and remains an inquiry; it does not assign a coach or reserve a time.

Owner workspace event purchases, shared lessons, payout buttons and waitlist offers are simulations. The sample camp/event purchase modal currently throws a ReferenceError. The real `/booking` API path is separate and passed its isolated tests.

## Scholarship offer, agreement and signature

The owner opens `/scholarships`, enters a wrestler name, parent email and program, then creates an offer through `/api/scholarships`. The server snapshots the saved monthly tuition as an informational reference value and creates a random 256-bit invitation token. Only its SHA-256 hash is stored. The returned private link places the token in the URL fragment. It is copied manually; no email or SMS is sent. Invitations expire after 30 days, can be rotated, and are bound to the invited verified parent email.

The initial agreement is draft text with acceptance closed. The owner must paste final attorney-reviewed terms and affirm review before the server marks the offer ready. This is an owner declaration, not an external legal-validation service. The default draft's proposed cumulative repayment does not itself create debt or trigger collection.

The parent opens the link, authenticates with the invited email, and selects the saved matching wrestler. The parent enters a printed name, draws a signature, sees the date, and checks agreement and electronic-signature consent. The server revalidates grade/approval, token, expiry and current terms revision. It atomically saves an active free scholarship and an immutable signature record with vectors, signer, account email, terms hash/version and server timestamp. A conditional database update also protects against concurrent family-profile or approval changes. A uniqueness constraint prevents two active awards for the same account/wrestler.

Both owner and family can access `/scholarship-agreement?id=...` after authorization. It returns the accepted terms, signature and signing record; an HTML attachment can be downloaded and browser printing can save PDF. Signature vectors are excluded from bulk award-list responses. Earlier typed-name records remain printable and are explicitly labeled as legacy. No automatic email copy or certified third-party e-sign service is integrated.

Ending a scholarship changes future entitlement while retaining its accepted agreement. Informational tuition value counts completed anniversary months since acceptance at the frozen rate and stops at the award end. Earlier unconditional training is not backdated into that calculation. No repayment amount is automatically invoiced or charged.

## Attendance and transfers

The owner Attendance view opens to today's New York date. Name search filters preview kids. Manual check-in evaluates sample registration/waiver/USAW fields and writes an attendance flag to the owner JSON. The camera scanner decodes sample passes, shows confirmation, and posts a same-origin message to the owner page. A tab-local roster badge appears once. Sample scans do not create real D1 attendance rows.

Transfer program changes a sample kid's program from today and records placement history for earlier roster dates. Its Advance approval checkbox does not create a real program_approvals decision. This transfer does not modify real family IDs, scholarship program assignments, paid subscriptions or payment amounts.

## Coach, planning and curricula

The owner grants real coach access through `/staff`. A verified coach signs in with MFA and edits only their own one-hour openings. The database rejects overlapping openings atomically. Paid booking is not connected to those openings.

Practice plans are keyed to program/date. Owner changes require a current scheduled practice, a valid revision and a plan totaling at most 90 minutes. Owners save drafts or publish. Active assigned coaches read only currently scheduled, published plans for their programs. Curricula are owner-only program groups containing ordered lessons; applying a lesson copies it into a daily draft without automatically publishing or coupling future edits.

## Messaging, archives and backups

Approval chat is a real family-scoped message service. General direct conversations, announcements, SMS consent controls and child messaging in the workspace are sample JSON records. There is no email/SMS delivery provider connected to those flows.

Event and related announcement archiving is derived from dates or explicit archive flags. Refresh occurs through render, focus/visibility and a minute timer, rather than a server cron job.

The owner backup tool exports only academy state, family profiles and coach openings. The browser encrypts the export with AES-GCM and a passphrase-derived PBKDF2 key. Restore validates the project and fingerprint, creates a recovery snapshot, and writes atomically. Missing backup records are retained and existing revisions increase. Scholarship contracts/signatures, approvals/chat, plans, curricula, staff permissions and integration secrets are not included by this export. Provider-level backups and actual production recovery were not verified.
