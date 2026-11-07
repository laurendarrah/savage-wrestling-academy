<!-- Comparison of Justin's ChatGPT Sites versions 71–131 with main (issue #187). Batches: D #188, A #189, B #190, C #191, E #192, F #193, G #194, H #195, I #196. Decisions: #197. -->
# Justin's Sites work (versions 71 to 131) compared with the main site

Prepared November 6, 2026. Compares the 63 entries in Justin's change log (Sites versions 71 to 131, branch `sites/v131`, commit `32c39b2`) with `origin/main` at `4dca2eb` (#186, partner and small-group lessons).

## Summary for Lauren

Justin kept building in ChatGPT Sites after we moved to GitHub. Of his 63 changes:

| Verdict | Count | What it means |
|---|---|---|
| Already covered | 10 | Main does the same or better. Nothing to do. |
| Port | 18 | Something useful that main does not have. Worth rebuilding on main. |
| Partly covered | 12 | Main has the core of it. A smaller piece is worth adding. |
| Conflicts | 14 | Goes against something we decided: test families and sample data, removing waitlists, or the old hourly lesson rate. Do not bring over. |
| Decision needed | 9 | Encodes a business rule (pay rates, timesheet rules, bookkeeping, the public website) that Justin must confirm first. |

**What he built that we don't have yet:**

1. **Family contact and safety details.** Home address, emergency contact, birth date and allergies on each family and wrestler. This is the most useful item before practices start on December 1.
2. **Coach profiles and invitations.** A join page for invited coaches, plus a profile with phone, bio, experience and photo. Justin can also act as a coach himself, with his own openings. Coaches can repeat an opening every week.
3. **Calendar improvements.** Holidays on every calendar, today highlighted, and times for each day of a camp or event.
4. **Coach drafts of practice plans.** Coaches draft plans for their programs and send them to the owner to publish. Coaches get a month view with camps and events.
5. **USA Wrestling card photos** and a renewal list. Needs photo storage (see below).
6. **Coach timesheets and payroll.** Clock in and out, monthly submission, owner review and corrections, payroll file. Also time-off requests. This is the largest piece and carries the most pay rules to confirm.
7. **An income and expense ledger** with yearly totals and charts.
8. **More than one signed document.** For example, a Parent Consent Form next to the waiver, sent to specific families.
9. **An editable preview of a public marketing website.**

**Do not bring over:** the built-in test family and fictional family previews, the sample payroll for a fictional coach, the example practice plans seeded for September to November, and the removal of waitlists. Main deliberately removed sample data (#147) and has live waitlists (#73). His navigation shells and sidebar layouts are also out, because the premium design (#149, #154) replaced them.

**Photo storage.** Coach photos and card photos need a Cloudflare R2 bucket. Lauren would create it on the academy's Cloudflare account and connect it to the Worker. Everything else works without it.

**Two warnings:**

- If anyone used Justin's Sites versions with real people (invited coaches, signed consent forms, timesheets, ledger entries or photos), those records exist only in his Sites database and photo bucket. Our backup restore does not carry them. We need to ask him.
- None of his database files can be copied as they are. His numbers 0013 to 0031 clash with ours, and his `wrestler_passes` table has the same name as ours but a different shape. Every port gets new migrations.

**Suggested order:** (1) family safety details, (2) calendar improvements, (3) coach profiles and invitations, (4) coach practice-plan drafts, (5) card photos, once R2 exists, (6) timesheets, payroll and time off, once Justin answers the pay questions, (7) ledger, (8) extra documents, after the attorney, (9) website preview, if wanted.

---

## How this was compared

- Read each change-log entry and its files in `/home/user/sites-v131` (`git diff 5a7e1a1 sites/v131 -- <path>`). Compared the same areas on `origin/main` (`git archive` of `4dca2eb`), its README, CLAUDE.md, `docs/LAUNCH_PLAN.md` and the GitHub issues.
- "Main" below means `origin/main`. Issue numbers (#n) are in laurendarrah/savage-wrestling-academy.

## Rules for every port

These apply to every batch below and are not repeated there.

1. **New migrations only.** Generate them with `pnpm db:generate` after main's `0030_faulty_surge.sql`. Never copy Justin's `drizzle/0013`–`0031` files or snapshots. Fold his chains into one migration per table. For example, `coach_time_entries` went through 0016, 0017, 0021, 0023, 0029 and 0030. Never create his `wrestler_passes` (main's table of that name differs), `program_enrollments`, `attendance_checkins` or `coach_lesson_rates`.
2. **Use the premium design.** His pages carry their own inline Arial and red styles. Rebuild each screen on `public/savage.css` and `lib/page-chrome.ts`, in sentence case and plain wording (#128).
3. **Use `appOrigin()`.** His `lib/account-auth.ts` hard-codes a `chatgpt.site` origin. Use `appOrigin()` for all links. Bring no ChatGPT Sites code: `app/chatgpt-auth.ts`, `lib/connector*`, `.openai/hosting.json`.
4. **Backups.** Add every new table to `lib/backup-records.ts`; `tests/backup-coverage.mjs` enforces this. Photos in R2 are not in the D1 backup and need their own backup plan. Changing the Deploy workflow's backup step needs the owner's approval.
5. **Family data.** Add new personal data to the family export (`lib/data-requests.ts`) and to the privacy and data-retention drafts in `docs/policies/`.
6. **Tests for inline JavaScript.** Typecheck does not cover it. Add a test in `tests/` for every screen function you port.
7. **Main's rules are the source of truth.** Program and grade rules live in `lib/program-approval.ts`, and prices only in `lib/quotes.ts`. Online checkout stays per type in `CHECKOUT_KINDS`.

## Per-entry triage

Batches A to I are defined in the next section. "Skip" means no port.

| # | Sites v | Change | Verdict | Where on main, or what is missing | Batch |
|---|---|---|---|---|---|
| 01 | 71 | Coach invitation, account setup, editable coach profile with photo (`coach_profiles`, R2) | **Port** | Main only has `/staff`: the owner grants access by email and picks programs, and the coach signs up on `/login`. Missing: an invite and join page, a coach profile (phone, bio, experience, specialties, photo) and an owner view of profiles. | B |
| 02 | 72 | Waivers & Contracts workspace: drafts, versions, per-family assignments, signing, signed copies | **Partly covered** | Main `/waivers` and `/waiver` publish one waiver version that every wrestler signs (drawn signature) before booking. Signed copies are at `/waiver-copy`; owner exceptions are in #89. Missing: several documents at once, a "contract" kind, sending a document to one family, and archiving or withdrawing a request. Would duplicate main's signature system if ported as is. | H |
| 03 | 73 | Owner also uses Coach View and has a coach profile | **Port** | `lib/access-control.ts` gives the owner role no coach staff record, and `app/api/coach/route.ts` rejects non-coaches. Justin cannot post lesson openings or appear as a coach. | B |
| 04 | 74 | Reusable Parent Consent Form starter text | **Decision needed** | Main's rule (`/waivers`): paste only attorney-approved text. Is a consent form wanted beside the waiver, and has an attorney approved this wording? | H |
| 05 | 75 | Owner coach directory, copy invite, manage openings; families browse openings on a month calendar | **Partly covered** | Family booking is better on main (`/lesson`: real seats, per-wrestler price, card and waiver checks, partner and group lessons, #177). Missing: the owner coach directory and invite copy, the owner managing a coach's openings (nothing on main writes `coach_openings` except the coach API), and an optional month view of openings. | B |
| 06 | 76 | Remove duplicate staff controls; rename the settings entry | **Already covered** | Main's dashboard was regrouped (#145, #150, #154). The sample staff editor is gone, and `/staff` is the only coach-access tool. | Skip |
| 07 | — | Shared Back controls that restore earlier view, filters and scroll | **Partly covered** | Main has the shared top bar on every page (#129) and "←" links on most pages. It does not restore filters or scroll position. Low value. | Skip |
| 08 | 77 | Back across redirects | **Partly covered** | Same as 07. | Skip |
| 09 | 78 | Owner monthly income and expense ledger (`financial_entries`); named month controls | **Decision needed** | Main has `/payments` (Stripe and offline payments, CSV) and `/coach-pay`. No expense ledger. The launch plan says bookkeeping stays outside the app, and #42 is open. Named month controls are already on main's calendar, registration and practice plans. | G |
| 10 | 79 | Collapsible owner sidebar groups | **Already covered** | Main's owner dashboard groups its tools (#145) with the premium look (#154). | Skip |
| 11 | 80 | Year totals and month-by-month figures | **Port** (with 09) | Needs the ledger first. | G |
| 12 | 81 | Private preview of a marketing website | **Decision needed** | Main has a public `/welcome` page with programs, weekly times and sign-up (#137, #181). Hosting a full marketing site is tied to #43 (custom domain and website migration). | I |
| 13 | 82 | Saved editor for the website (headline, theme colors, staff, wrestler achievements, alumni) | **Decision needed** | The theme color editor would undo the fixed premium palette. Wrestler names and photos need parent permission. External image links need a CSP review. | I |
| 14 | 83 | Family membership and purchase "previews"; website button tweaks | **Conflicts** | Main shows real memberships and purchases on the family home (#21, #137). The previews are sample screens of the kind removed in #147. The button tweaks belong to batch I. | Skip |
| 15 | 84 | Remove paid-in-full signup; permanently delete a removed coach | **Decision needed** + Port | Main still sells "memberships paid upfront" (`annual` in `lib/purchase-kinds.ts`, `lib/quotes.ts`). Justin removed that option, so this needs a decision. Permanent coach deletion is missing on main, which only revokes (`active=0`). That part is a port. | B (deletion) |
| 16 | 85 | Capitalize "Programs & Pricing" | **Already covered** | Main's wording pass (#128) uses sentence case ("Programs & pricing"). | Skip |
| 17 | 86 | Ledger charts | **Port** (with 09) | — | G |
| 18 | 87 | Coach clock-in and clock-out, owner review, approval, payroll CSV (`coach_time_entries`) | **Port** | Nothing on main. Encodes hourly rates of head coach $40 and assistant $30 (`coachDuties` in `lib/coach-time.ts`), which need confirming. | F |
| 19 | 88 | Bolder Coach View, large coach buttons | **Already covered** | Main's coach home leads with "Today on the mat" and premium buttons (#134, #174). | Skip |
| 20 | 89 | Void a test shift from payroll | **Port** | Voiding is useful for any mistaken shift, not only test ones. | F |
| 21 | 90 | Coach time-off requests (`coach_time_off`) | **Port** | Nothing on main. | F |
| 22 | 91 | Persistent Coach View tabs | **Already covered** | Main uses the shared top bar plus the coach home. A tab shell would clash with the premium layout. | Skip |
| 23 | 92 | Day and time ranges for each camp, clinic or event day | **Port** | Main events have dates only (`lib/academy-validation.ts`). Start and end times exist only for extra practices (`lib/friday-live.ts`). Main's roster event sessions have no times. | A |
| 24 | 93 | Rename to "Camps & Events" and remove the waitlist | **Conflicts** | Waitlists are built and live on main (#73, `/waitlists`, `lib/waitlist.ts`). "Camps & events" naming is already on main. Ask Justin whether he wants waitlists off. | Skip |
| 25 | 94 | "Request Time Off" button | **Port** (with 21) | — | F |
| 26 | 95 | Family filter by program; live attendance; QR passes (`program_enrollments`, `attendance_checkins`, `wrestler_passes`) | **Already covered** | Main has `/roster` from paid orders, offline payments and active scholarships (`lib/roster.ts`), the `attendance` table, QR passes and a scanner (#71, #83), and `/payments` for outside payments (#63). Do not port his tables. Only the program filter on `/accounts` is missing (main has search and a count, #170). | D (filter only) |
| 27 | 96 | Attendance access; per-family waiver tracking and reissue; editable coach timesheets (0020, 0021) | **Partly covered** | Roster and scanner are covered by `/roster`. Per-wrestler signed and unsigned status with search is on main `/waivers`. Missing: reissuing a withdrawn document (batch H) and timesheet drafts (batch F). | F, H |
| 28 | 97 | Coaches must submit the whole month, from the last day of the month (Eastern) | **Decision needed** | Payroll rule. Is month-end submission required, and is pay monthly or twice a month (`timePeriod` has "first" 1–15 and "second" 16–end)? | F |
| 29 | 98 | Signature requests go to a parent or guardian; guardian role required | **Partly covered** | Main waivers are signed by "a parent (or the adult wrestler)" with printed name, drawn signature and consent (`lib/waivers.ts`). Missing: an explicit signer-role choice and a guardian-only rule per document. | H |
| 30 | 99 | Built-in test family with three wrestlers | **Conflicts** | Sample and test families were removed on purpose (#147). Testing uses `pnpm e2e` on a throwaway local database. | Skip |
| 31 | 100 | Protected deletion of test families and wrestlers | **Conflicts** | Main never deletes families automatically. Closure is an owner decision recorded under data requests (#113, `lib/data-requests.ts`). | Skip |
| 32 | 101 | Owner sidebar stays visible; in-place tool panel; demo flow | **Conflicts** | Main's premium dashboard links to real tool pages. The panel and demo flow serve the test family. | Skip |
| 33 | 102 | Named test wrestlers; migration 0022 renames test data; Parent View inside the workspace | **Conflicts** | Demo data and in-workspace family previews were removed (#147). | Skip |
| 34 | 103 | Fix stale test-family deletions | **Conflicts** | Follows 31. | Skip |
| 35 | 104 | Keep headers when switching views | **Already covered** | `lib/page-chrome.ts` shared top bar (#129). | Skip |
| 36 | 105 | Family Account tabs | **Already covered** | Main's family home has one clear next step (#137, #142). | Skip |
| 37 | 106 | Per-coach private-lesson hourly rate, $65 default (`coach_lesson_rates`) | **Conflicts** | Main pays lessons as a percentage per coach, from real paid orders (`/lesson-settings`, `lib/coach-pay.ts`, #75, #177). Justin replaced the hourly rate himself in entry 57. Do not port. Ask him to confirm. | Skip |
| 38 | 107 | Weekly recurring lesson openings; seeded fall 2026 example practice plans (0024) | **Partly covered** | Recurring openings are missing: main coaches add one opening at a time (`app/coach/screen.html`, `lib/lessons.ts`), so port that part. The seeded examples conflict: they are sample data for September to November, which is already past. Main has the starter schedule (#178). | B (recurring) |
| 39 | 108 | Meetings added to the example plans (0025) | **Conflicts** | Edits seeded sample plans. | Skip |
| 40 | 109 | Update the shared example plan (0026) | **Conflicts** | Same as 39. | Skip |
| 41 | 110 | Warm-up and cool-down only in the examples (0027) | **Conflicts** | Same as 39. Main's plan builder already has `warmup` and `cooldown` block types (`lib/practice-plans.ts`). | Skip |
| 42 | 111 | Monthly practice-plan calendar in Coach View | **Partly covered** | Main `/practice-plans` has a month selector and a list for coaches. No calendar grid. | C |
| 43 | 112 | Public calendar colors: Advance black, Intermediate gray, Development white, events red | **Already covered** | Main `app/calendar/screen.html` uses exactly these (`.competition`, `.development`, `.elementary`, `.special`). | Skip |
| 44 | — | The same colors on every calendar; persistent navigation | **Partly covered** | Colors are only on the public calendar. Coach, practice-plan, registration and owner calendars lack them. Add them as `savage.css` tokens. The navigation part is covered by #129. | A |
| 45 | 113 | Camps, clinics, events and extra practices on the coach calendar | **Partly covered** | The coach home shows today's sessions, and the roster includes event days. No month view with them. | C |
| 46 | 114 | Holidays on owner, coach and public calendars | **Port** | Main's owner holiday planner (`holidayPlannerMarkup` in `app/portal.html`) only helps choose exclusions. Public and coach calendars show no holidays. Move the holiday calculation into a shared lib, as Justin did in `lib/registration-catalog.ts`. | A |
| 47 | 115 | Hide "No practice" cards on holidays | **Port** (with 46) | — | A |
| 48 | 116 | Remove "No practice" cards and legend labels | **Port** (with 46) | Check against main's phone calendar, which already skips empty weeks (#183). | A |
| 49 | 117 | Coaches draft and submit practice plans; several programs per coach (`practice_plan_submissions`) | **Port** | Main: only the owner writes plans, and coaches read shared ones. Several programs per coach is already covered (`/staff` allows up to three). | C |
| 50 | 118 | Show 15 minutes of prep and 15 of cleanup around a practice | **Decision needed** | Replaced by 51. Pay rule. | F |
| 51 | 119 | 10-minute allowance; flag early or late punches, long shifts and back-to-back classes (`practice_context`) | **Decision needed** | Pay rule: a 10-minute allowance and a 15-minute back-to-back window (`lib/coach-practice-time.ts`). In v131 the allowance passed to new shifts is 0. The flagging logic is worth porting once the rule is confirmed. | F |
| 52 | 120 | Easier "Draft a plan"; owner can draft in Coach View | **Port** (with 49) | — | C |
| 53 | 121 | Highlight today (Eastern date) on calendars and date grids | **Port** | Main uses `today` only to grey out past days. No "Today" label or highlight. | A |
| 54 | 122 | Pricing, scholarships and codes grouped; team codes get their own view | **Partly covered** | Main's dashboard groups these tools (#145). Team codes are still inside the workspace editor. A separate view is optional. | Skip |
| 55 | 123 | Sample month of payroll for fictional coach "Jordan Avery" | **Conflicts** | Sample data. | Skip |
| 56 | 124 | Coach filter; payroll breakdown by program and duty | **Port** (with 18) | — | F |
| 57 | 125 | Lessons pay 65% coach / 35% academy for all lesson types; scheduled practice time used for pay (0030) | **Decision needed** | Lesson pay is covered better on main: `/coach-pay` uses each coach's percentage on real paid orders, while his v131 has coaches type in what they collected. Confirm 65% as the default (`defaultSplit` on `/lesson-settings`, no code needed). Paying practices by scheduled time instead of clock time is a payroll rule (batch F). | F |
| 58 | 126 | Fix the sample back-to-back shifts | **Conflicts** | Sample data. | Skip |
| 59 | 127 | Hour and minute controls for payroll corrections | **Port** (with 18) | — | F |
| 60 | 128 | Shorter Programs & Pricing introduction | **Already covered** | Main's wording pass (#128) and dashboard redesign. | Skip |
| 61 | 129 | Three fictional one-child family previews | **Conflicts** | Sample families (#147). | Skip |
| 62 | 130 | Home address, emergency contact, birth date, allergies; signed copies easier to find | **Port** | Main's family profile is only parent name, phone and wrestlers with name, grade and card (`lib/family-records.ts`). Signed copies are covered by `/waivers` and `/waiver-copy`. | D |
| 63 | 131 | USA Wrestling card photo, owner verification, 30-day renewal list with email draft, card required for check-in, separate address fields (`wrestler_membership_cards`, R2) | **Partly covered** | Covered: number and season expiry, owner verification with a one-tap lookup on `/cards`, an August renewal count, expiring and expired notices, and booking blocks (#68, #131). Missing: the card photo (R2) and a rolling renewal list. Conflicts: blocking check-in. Main decided check-in still works with a warning (`lib/roster.ts`, #68). His test-entry exemption is also out. The separate address fields belong to batch D. | E, D |

## Porting batches, in suggested order

### 1. Batch D: Family contact and safety details. Size S to M. No R2.

- **Entries:** 62, the address part of 63, and the program filter from 26.
- **What:** Families add a street address (street, city, state, ZIP), an emergency contact name and phone, and a birth date and allergies or medical notes per wrestler. The owner sees them on `/accounts`, with a filter by program. Coaches may see emergency details on the roster, if Justin agrees.
- **Tables:** none new. The fields go in the `family_accounts.payload` JSON.
- **Files:** `lib/family-records.ts` (`validFamily`, `cleanFamily`), `app/api/family/route.ts`, `app/family/screen.html`, `app/accounts/route.ts`, optionally `lib/roster.ts` and `app/roster/screen.html`, `lib/data-requests.ts`, `docs/policies/privacy-policy-draft.md`, `docs/policies/data-retention-draft.md`. Tests: `tests/family-confirmation.mjs`, `tests/accounts.mjs`, `tests/accounts-search.mjs`, `tests/data-requests.mjs`.
- **Risks:**
  - Medical data about children is sensitive. Limit who sees it, and update the privacy draft before launch.
  - Making fields required would block existing families from saving. Keep older profiles valid.
  - Birth date must not override main's grade-based program rules (`lib/program-approval.ts`).
  - Kindergarten stays the string `"K"`.

### 2. Batch A: Calendar improvements. Size S. No R2.

- **Entries:** 23, 44, 46, 47, 48, 53.
- **What:**
  - Holidays (actual and observed) on the public, coach and owner calendars, shown for information only.
  - Today highlighted with a "Today" label, using the New York date.
  - Start and end times for each camp, clinic or event day, shown on the calendar, the booking review and the roster.
  - The program colors on every calendar.
- **Tables:** none. Event times go in `academy_state.payload`, the `events[].schedule` array.
- **Files:** `lib/academy-validation.ts`, a new `lib/event-schedule.ts`, `lib/public-schedule.ts`, `lib/registration-catalog.ts` (shared holiday calculation), `lib/roster.ts` (event start and end), `app/portal.html` (event editor), `app/calendar/screen.html`, `app/coach/screen.html`, `app/practice-plans/screen.html`, `app/register/screen.html`, `app/booking/screen.html`, `public/savage.css`. Tests: `tests/planning-calendar.mjs`, `tests/events.mjs`, `tests/registration.mjs`, `tests/calendar-week.mjs`, `tests/owner-workspace.mjs`.
- **Risks:**
  - Saved events have no times. Validation must keep accepting them, and restoring older backups must still work.
  - The holiday list is a policy choice.
  - Daylight-saving edges for "today".
  - Inline JavaScript in five screens needs tests.

### 3. Batch B: Coach profiles, invitation and onboarding. Size M; L with photos. R2 needed for photos only.

- **Entries:** 01, 03, the owner directory, invite copy and owner-managed openings from 05, the permanent coach deletion from 15, and the weekly recurring openings from 38.
- **What:**
  - A coach join page (`/coach-join`) and sign-up that lands coaches on the coach home.
  - A coach profile with name, phone, bio, experience, specialties and an optional photo.
  - An owner coach directory.
  - The owner (Justin) can act as a coach: profile, openings, and inclusion in the coach pay report.
  - The owner can add or remove openings for a coach.
  - Coaches can repeat an opening weekly.
  - A removed coach can be permanently deleted, keeping lesson and pay history.
- **Tables:** `coach_profiles` (new migration). No `coach_lesson_rates`.
- **Files:**
  - New: `app/coach-join/route.ts` and `screen.html`, `app/api/coach-profile/route.ts`, `app/api/coach-photo/route.ts`, `lib/coach-profile.ts`.
  - Modified: `app/api/auth/route.ts` (coach context on sign-up and reset, via `appOrigin()`), `app/auth/confirm/route.ts`, `lib/access-control.ts`, `app/api/coach/route.ts`, `lib/lessons.ts`, `app/coach/screen.html`, `app/staff/route.ts`, `app/staff/screen.html`, `app/api/staff/route.ts`, `lib/coach-pay.ts`, `lib/backup-records.ts`, `cloudflare-env.d.ts` and the R2 binding in `vite.config.ts`.
  - Tests: new `tests/coaches.mjs`; `tests/lessons.mjs`, `tests/group-lessons.mjs`, `tests/coach-pay.mjs`.
- **Risks:**
  - Letting the owner act as a coach touches the most sensitive check (`verifiedOwner`). Keep owner MFA rules intact.
  - Deleting a coach must not orphan booked lessons or paid orders.
  - Photo uploads need size and type checks; Justin's `rasterType` is a good basis.
  - R2 objects are outside D1 backups.
  - The coach-context redirect must stay on an allowlisted origin.
  - Recurring openings must respect seat holds (`lib/capacity.ts`) and never create clashing openings.

### 4. Batch C: Coach practice-plan drafts and the coach month calendar. Size M. No R2.

**Outcome (#191):** the coach month calendar (entries 42 and 45) is built. Coach drafts (entries 49 and 52) were dropped: Justin answered #197 question 20 that coaches do not draft plans; he writes them.

- **Entries:** 42, 45, 49, 52.
- **What:**
  - Coaches draft plans for their assigned programs and submit them. The owner reviews, edits and publishes.
  - The owner can draft for any program.
  - Coaches get a month calendar with practices, extra practices, camps and events.
- **Tables:** `practice_plan_submissions` (new). Publishing still writes `practice_plans`.
- **Files:** `app/api/practice-plans/route.ts`, `app/practice-plans/screen.html`, `lib/practice-plans.ts`, `app/coach/screen.html`, `lib/backup-records.ts`. Tests: `tests/practice-plans.mjs`, `tests/practice-plan-ui.mjs`, `tests/practice-curricula.mjs`.
- **Risks:**
  - Overlap with practice curricula on main (`/curricula`).
  - Who sees drafts.
  - Plan revisions when a draft and a published plan both change.
  - Depends on batch B only if the owner-as-coach flow is reused.

### 5. Batch E: USA Wrestling card photos and the renewal list. Size M. R2 required.

- **Entries:** the photo and renewal parts of 63.
- **What:**
  - Families upload a photo of each wrestler's card. The owner views it next to the lookup on `/cards`.
  - A rolling "renews within N days" list with an email draft link.
  - Check-in stays allowed with a warning unless Justin decides otherwise.
- **Tables:** a small new table for card photos (wrestler, number and expiry the photo belongs to, R2 key, type, uploaded at). Alternatively, add columns to `usaw_reviews`. Do not adopt his `wrestler_membership_cards`: it duplicates the number and expiry already in the family profile, and they would drift apart.
- **Files:** `lib/usaw.ts`, `app/api/usaw-cards/route.ts`, `app/cards/screen.html`, `app/family/screen.html`, `app/api/family/route.ts`, a new photo route, `lib/notify.ts`, `lib/backup-records.ts`, `lib/data-requests.ts`. Tests: `tests/usaw-cards.mjs`, `tests/card-seasons.mjs`, `tests/roster.mjs`.
- **Risks:**
  - These are images of children's membership cards. Set retention and access rules.
  - R2 backups.
  - A new photo must clear an earlier owner review only when the number or expiry changes, matching how `usaw_reviews` works today.

### 6. Batch F: Coach timesheets, payroll and time off. Size L. No R2. Blocked on decisions.

- **Entries:** 18, 20, 21, 25, the timesheet part of 27, 28, 50, 51, 56, the practice-pay part of 57, and 59.
- **What:**
  - **Coaches:** clock in and out, edit drafts, submit the month, and request time off.
  - **Owner:**
    - Review, correct (hours and minutes), approve or void shifts.
    - See flags for early or late punches, long shifts and back-to-back classes.
    - Filter by coach, with a breakdown by program and duty.
    - Download a payroll CSV.
    - Review time-off requests.
  - Lesson pay stays on main's `/coach-pay`, from paid orders. Do not port his self-reported "collected lesson revenue" fields.
- **Tables:**
  - `coach_time_entries`: one new migration with the final columns, without the lesson fields.
  - `coach_time_off`.
- **Files:**
  - New: `app/coach-time/route.ts` and `screen.html`, `app/api/coach-time/route.ts`, `app/coach-time-off/route.ts` and `screen.html`, `app/api/coach-time-off/route.ts`, `lib/coach-time.ts`, `lib/coach-practice-time.ts`.
  - Modified: `app/coach/screen.html`, `app/portal.html` (dashboard link), `lib/coach-pay.ts` (one place for all coach pay), `lib/backup-records.ts`, `lib/launch-checklist.ts` (optional).
  - Tests: new `tests/coach-time.mjs` and `tests/coach-time-off.mjs`.
- **Risks:**
  - Wage and hour rules (employee or contractor, overtime). Justin's CSV says "estimated straight-time gross".
  - Eastern time and daylight saving.
  - Many pay rules, so ship nothing until they are confirmed.
  - Two pay reports (hourly and lesson) must not double count.
  - Depends on batch B for Justin as a coach.

### 7. Batch G: Financial ledger. Size M. No R2. Blocked on a decision.

- **Entries:** 09, 11, 17.
- **What:**
  - Monthly and yearly income, expenses and net, with category charts.
  - The owner records and voids manual entries (rent, supplies, other).
  - On main, income should come automatically from `orders` (Stripe and offline payments, net of refunds), and coach pay from `/coach-pay` and batch F, instead of being typed in twice. His Sites version had no orders table, so everything there was manual.
- **Tables:** `financial_entries` (new), for manual entries only.
- **Files:** new `app/financials/route.ts` and `screen.html`, `app/api/financials/route.ts`, `lib/financials.ts`; owner dashboard link; `lib/backup-records.ts`. Tests: new `tests/financials.mjs`. Charts follow the site's chart guidance.
- **Risks:**
  - Double counting against Stripe.
  - Stripe fees are not known yet (#42).
  - This is not an accounting system, so say so on the page.
  - The launch plan currently keeps bookkeeping outside the app.

### 8. Batch H: Documents and contracts beside the waiver. Size L. No R2. Needs the attorney.

- **Entries:** 02, 04, the reissue part of 27, and 29.
- **What:**
  - Several named documents (waiver, parent consent, contract), each versioned.
  - Each document is either required for every wrestler (like today's waiver) or sent to chosen families.
  - Signer role (parent or guardian, or adult wrestler).
  - Reissue or withdraw a request; signed copies for owner and family.
- **Approach:** extend main's waiver system (`waiver_versions`, `waiver_signatures`, booking block, owner exceptions, notices) to several documents. Do not add his parallel `document_templates`, `document_versions` and `document_assignments`, which would give two signature systems.
- **Tables:** a document id and kind on `waiver_versions`, plus a new table for per-family requests. Existing signatures stay valid.
- **Files:** `lib/waivers.ts`, `app/waivers/*`, `app/waiver/*`, `app/waiver-copy/route.ts`, `app/api/waiver/route.ts`, `app/api/waivers/route.ts`, `app/family/screen.html`, `lib/notify.ts`, `lib/exceptions.ts`, `lib/backup-records.ts`. Tests: `tests/waivers.mjs`, `tests/exceptions.mjs`, `tests/notifications.mjs`.
- **Risks:**
  - Legal wording and e-signature validity (#44 covers the scholarship equivalent).
  - Which documents block booking.
  - Migrating existing signed waivers without invalidating them.

### 9. Batch I: Website preview. Size M. R2 optional.

- **Entries:** 12, 13, the website part of 14.
- **What:** an owner-edited marketing page (headline, intro, contact, staff, wrestler achievements, alumni) previewed privately and possibly published later.
- **Tables:** none. Store it as a settings document, an `academy_settings` row such as `website`.
- **Files:** new `app/website-preview/route.ts`, `app/website-preview/editor.ts`, `lib/website-draft.ts`, `public/swa-website-editor.js`. Use `savage.css` instead of `swa-website.css`. Reconcile with `app/welcome/*`. The `swa-wolf-logo.webp` asset is not needed (main has `public/brand/`). `swa-justin-accordino.webp` needs Justin's consent to publish.
- **Risks:**
  - Duplicates `/welcome`.
  - The color editor undermines the premium design. Drop it.
  - Publishing children's names and photos needs parent permission.
  - External image URLs need a CSP review, or upload to R2.
  - Depends on #43 (domain).

### Not ported

Entries 06, 07, 08, 10, 14 (previews), 16, 19, 22, 24, 26 (tables), 30–37, 39–41, 43, 54, 55, 58, 60, 61, the 38 sample plans, and the 63 check-in block (unless Justin decides otherwise). The reasons are in the table.

## Questions for Justin

Justin answered these in #197. Q9 (no year paid upfront), Q10 (no waitlists), Q11 (a card problem blocks check-in) and Q13 (30-day renewal list) are built in #210, which supersedes the "Decision needed" and "Conflicts" notes on entries 24 and 63 and the upfront-membership note above.

**Pay and time**

1. Should practices pay head coaches $40 an hour and assistants $30 an hour, or should each coach have their own rate?
2. Should private lessons pay the coach 65% and the academy 35% by default, for one-on-one, partner and small-group lessons alike? Main can already set a share for each coach.
3. Is the old $65-per-hour lesson rate fully retired? Were any lessons paid that way that we need to keep a record of?
4. Are coaches paid for prep and cleanup around a practice? If so, is it 10 minutes or 15 minutes on each side, or are they paid only for the scheduled practice time?
5. Must coaches submit their whole month's timesheet on or after the last day of the month? Are coaches paid monthly, or twice a month (1st–15th and 16th–end)?
6. Are your coaches employees or contractors? This affects overtime and what the payroll file should show.
7. When you approve a time-off request, should anything else happen, such as telling the other coaches or changing the schedule? Or is it only a record?

**Money and memberships**

8. Do you want the site to keep the academy's income and expenses, or will bookkeeping stay with an outside tool or accountant? If the site keeps them, should card and offline payments flow in automatically?
9. You removed the paid-in-full 12-month membership in Sites. Should families still be able to pay a full year upfront, or only walk-in and monthly?
10. You removed waitlists in Sites. Should full camps and events keep their waitlist, which is live on the new site?

**Cards, safety and documents**

11. Should a missing, expired or unverified USA Wrestling card stop a wrestler from being checked in at practice? Today it blocks booking and shows a warning at the door.
12. Must families upload a photo of the USA Wrestling card, or is the number plus your lookup enough? How long should photos be kept?
13. How many days before a card expires should it appear on your renewal list?
14. Which family details should be required: home address, emergency contact, birth date, allergies or medical notes? Should coaches see allergies and emergency contacts on the check-in roster?
15. Besides the waiver, which documents must families sign? Must the Parent Consent Form be signed before booking, and has an attorney approved its wording?
16. May a wrestler who is 18 or older sign documents for themselves?
17. Do you want coaches to sign contracts through the site?

**Coaches, calendar and website**

18. When you permanently remove a coach, what must be kept: past lessons, pay records, signed documents?
19. Which holidays should the calendars show? Should a holiday only be shown, or also cancel practice automatically?
20. Should coaches be able to draft practice plans for you to approve? May coaches see each other's drafts?
21. How many weeks ahead may a coach repeat a weekly lesson opening?
22. Do you want the site to host the academy's public marketing website, with staff bios, wrestler achievements and alumni? On which web address? Do you have parents' permission to show wrestlers' names and photos?

**Data from Sites**

23. Did anyone use Sites versions 71 to 131 with real people: invited coaches, signed consent forms, timesheets, ledger entries, or coach or card photos? If yes, please export those tables and the photo bucket so we can move them. Our backup restore only carries the older tables.
24. Can you confirm that Sites is now frozen, with every change going through GitHub (decision #8)?
