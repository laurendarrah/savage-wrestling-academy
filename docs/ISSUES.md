# Known issues: the handoff review's findings and where they went

The November 5, 2026 handoff review listed 21 findings about the ChatGPT Sites version of the site. This page keeps each one with its status as of November 7, 2026 (#267), so nobody re-reports a solved problem or forgets an open one. The review's full wording is in git history (this file's history before #267) and the rest of the package is in [the archive](archive/handoff-2026-11-05/README.md).

**Open work is tracked as GitHub issues, on the [Launch board (#246)](https://github.com/laurendarrah/savage-wrestling-academy/issues/246).** Add new problems there, not here. Priorities: P0 blocks launch, P1 is high business or operational risk, P2 can wait.

| Finding | Was | Status now |
|---|---|---|
| **SEC-01** Dependency advisories (8 production advisories, 2 critical) | P0 | **Fixed.** `pnpm audit --prod` is clean and runs on every pull request; dev advisories handled in #48. Details in [DEPENDENCY_ADVISORIES.md](DEPENDENCY_ADVISORIES.md) |
| **AUTH-01** Email links pointed at an old Sites address | P0 | **Fixed.** `APP_ORIGIN` is required and has no default (#119); sign-in moved to an academy-owned Supabase project (#139). Its redirect list is a [GO_LIVE](GO_LIVE.md) step |
| **DATA-01** Sample wrestlers and real families were two separate worlds | P0 | **Fixed.** The sample directory and screens are gone (#37, #147); rosters, transfers and messages use real family records and paid orders (#22, #72, #74) |
| **DATA-02** Backups missed most tables | P0 | **Fixed.** Backups cover every business record and large files (#78, #221). Proving a restore: restore drill, open (#25) |
| **PAY-01** No checkout or signed webhook | P0 | **Built.** Checkout, signed idempotent webhook, monthly memberships, refunds and live mode (#18, #19, #20, #26). Each purchase type opens with `CHECKOUT_KINDS`; going live is open (#26), waiting on terms (#2) and the refund policy (#3) |
| **DEMO-01** Sample camp review threw a ReferenceError | P1 | **Gone.** The sample screens were removed (#147) |
| **DEMO-02** Sample grade rules disagreed with the server | P1 | **Gone** with the sample screens. The workspace's rules are typed modules checked against `lib/program-approval.ts` (#45) |
| **SEC-02** Leaked-password protection off in Supabase | P1 | **Moved** to the new Supabase project's settings in [GO_LIVE](GO_LIVE.md) §6 (#11 closed as not applicable, #139) |
| **AUTH-02** One hard-coded owner, no tested recovery | P1 | **Open by design.** Still one owner email. Backup authenticator on the launch checklist (#167) and when the authenticator is switched back on (#27); recovery steps in [RUNBOOK](RUNBOOK.md) ("The owner is locked out") |
| **BOOK-01** Capacity and lessons were not real bookings | P1 | **Fixed.** Seat limits enforced through checkout and the webhook (#36); lessons booked against real coach openings (#70, #177). Waitlists were later removed (#210) |
| **ATT-01** No real QR attendance, waiver or card evidence | P1 | **Fixed.** Attendance (#22), QR passes (#71), waivers (#69), USA Wrestling cards (#68, #202) |
| **MSG-01** Messages had no delivery | P1 | **Built in-app** (#72). Email waits on Resend being set up (#35) |
| **SCH-01** Scholarship terms and repayment are policy work | P1 | **Open.** Attorney review (#44). Benefit totals stay informational |
| **SCH-02** Signatures are not externally certified | P1 | **Open, unchanged.** What assurance is needed is a question for the attorney (#44) |
| **ARCH-01** 155 KB of inline JavaScript in the owner workspace | P1 | **Mostly fixed.** Sample screens removed (#147) and rules moved to typed `lib/workspace/` modules (#45); `app/portal.html` is about 76 KB. Inline page scripts are still not typechecked, so every change needs a test |
| **ARCH-02** Whole-document saves and unpaged lists | P2 | **Mostly fixed.** Lists are paged and load-checked at 3,000 families (#46, #92, #219, #242). The academy settings are still one revisioned document. Plan limits: [GO_LIVE](GO_LIVE.md) §1 |
| **OPS-01** No staging, monitoring or recovery drill | P1 | **Mostly fixed.** Runbook (#165), error alerts and health check (#107, #47), test alert (#263), the walkthrough and payment rehearsal on local copies in CI (#103, #111), pre-deploy backups. Open: uptime monitor (#47), restore drill (#25). There is still no separate staging site |
| **DOC-01** Docs and setup wrappers were stale | P2 | **Fixed.** New README and contributing guide (#30), the Sites install wrappers removed and the docs reorganised (#267) |
| **DEMO-03** The admin demo's form sandbox | P2 | **Gone.** `/admin-demo` was removed (#147) |
| **SEC-03** Security validation scope | P2 | **Partly done.** Security review fixes (#97), per-feature rate limits (#114) and security tests in `tests/`. No penetration test |

## Things that look like bugs but are not

These are recorded in CLAUDE.md because they have caught people before:

- Older academy settings documents can hold sample `kids`, `bookings`, `messages`, `offers` and `staff`. Nothing reads them.
- A new site lists no programs until the owner publishes them from the launch checklist.
- Online checkout exists, but each purchase type stays closed until `CHECKOUT_KINDS` lists it.
- `waitlist_entries` and upfront-year (`annual`) orders still exist in old data. They are kept and shown read-only; nothing creates new ones (#210).
