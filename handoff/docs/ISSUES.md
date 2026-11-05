# Known issues and technical debt

Priority P0 blocks a production launch. P1 is high business or operational risk. P2 improves maintainability or requires targeted validation. Confirmed findings are separated from architectural limitations and unverified concerns. No remediation was applied during this review.

## SEC-01 Dependency advisories

Priority P0. Evidence status Confirmed package audit.

Eight production-graph advisories, including two critical, affect declared Next.js, Zod and fast-uri versions. Runtime exploitability is unproven because this deployment uses Vinext rather than a standard Next server.

Proposed work. Review evidence/dependency_audit.json, trace built-artifact reachability, upgrade or remove affected packages in a development branch, and regression-test the exact Worker build.

## AUTH-01 Old authentication callback origin

Priority P0. Evidence status Confirmed source/config mismatch.

APP_ORIGIN points at the old wellrose34 Site while current deployment is under justinaccordino546. Signup/resend/reset emails reuse the constant; account-setup displays it too. Live redirect behavior and Supabase allowlist were not tested.

Proposed work. Align configurable allowed origins and actual Supabase settings. Test confirmation, recovery, password changes, logout and MFA recovery with controlled accounts.

## DATA-01 Two wrestler/membership namespaces

Priority P0. Evidence status Confirmed architecture gap.

academy_state.kids drives the admin sample directory, roster and transfers, while family_accounts and scholarship_awards drive real family workflows. No canonical paid enrollment or operational athlete table bridges them.

Proposed work. Design one stable identity/enrollment model, migrate sample-vs-real separation explicitly, and make roster/access derive from real entitlements.

## DATA-02 Incomplete backup coverage

Priority P0. Evidence status Confirmed source limitation.

Manual exports omit scholarships, signed terms and signature records, approvals/chat, plans/curricula and other normalized tables. Recovery snapshots are in the same D1 instance.

Proposed work. Create a complete protected backup/recovery path and retention policy, preserve secret wrapping keys separately, and prove restoration into a separate environment.

## PAY-01 Checkout and signed fulfillment absent

Priority P0. Evidence status Confirmed source and Stripe metadata.

No Checkout creation or webhook handler exists. Stripe endpoint targeting /api/stripe-webhook is disabled, and payment APIs explicitly return disabled state.

Proposed work. Build and test order/checkout lifecycle, authentic signed webhooks, idempotency, paid entitlement and failure/cancellation/refund reconciliation before any live charge.

## DEMO-01 Sample event review throws ReferenceError

Priority P1. Evidence status Reproduced in isolated VM.

finishEvent renders annual?0:base-price without defining annual. It affects the sample camp/event review modal. Existing 18 test scripts and TypeScript/build do not detect the inline-JS failure.

Proposed work. Run the packaged reproduction. Fix the scoped expression and add a regression covering the sample event entry point. Do not confuse the separate working booking-review API with this modal.

## DEMO-02 Sample grade and approval rules drift

Priority P1. Evidence status Confirmed source discrepancy.

bookDrop still uses Development grades 1-5, Intermediate 6-12 and only a junior Advance approval check. Real registration correctly enforces K-6, 7-12 and all Advance grades. editKid also lacks Kindergarten.

Proposed work. Consolidate grade/approval representations across both interfaces and test every normal entry point, or clearly limit/remove stale sample registration paths.

## SEC-02 Compromised-password protection disabled

Priority P1. Evidence status Supabase advisor confirmed.

The connected Supabase project reports auth_leaked_password_protection as WARN.

Proposed work. Review the project plan/configuration and enable the supported protection. Remediation https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## AUTH-02 Single hard-coded owner and incomplete recovery operations

Priority P1. Evidence status Confirmed design; operations unverified.

Only one verified owner email is recognized. There is no real admin/reviewer role, owner handover UI or verified emergency MFA recovery process.

Proposed work. Define least-privilege collaboration and recovery procedures. Test owner/coach recovery without weakening the existing AAL2 requirement.

## BOOK-01 Capacity and lesson booking are not transactional

Priority P1. Evidence status Confirmed implementation limit.

Real APIs review choices only. Sample slot counts, waitlist offers and lesson participation/payouts are not a live reservation ledger; real coach openings are disconnected from paid booking.

Proposed work. Implement atomic inventory/holds and coach assignment with retry/expiry rules, then payment fulfillment and cancellation release behavior.

## ATT-01 Real QR attendance and participation evidence absent

Priority P1. Evidence status Confirmed implementation limit.

Scanner is sample-only; actual family schema lacks waiver/card evidence and there is no real check-in table.

Proposed work. Build operational entitlement/waiver/card checks, secure pass issuance, revocation and idempotent per-session attendance records before using it at the door.

## MSG-01 General messaging has no delivery service

Priority P1. Evidence status Confirmed implementation limit.

Approval chat works as a protected stored thread, but general direct/announcement/email/SMS flows save sample owner JSON only.

Proposed work. Define consent and delivery requirements, integrate a transactional channel, and add receipts/failure handling and scoped family conversations.

## SCH-01 Scholarship contract and collection remain policy work

Priority P1. Evidence status Confirmed implementation boundary.

Attorney review is represented by an owner checkbox and pasted terms. There is no external legal validation or automatic repayment billing. Benefit totals exclude the current partial month and never backdate earlier unconditional support.

Proposed work. Finalize the agreement and legal review outside the code, clarify benefits/termination/exceptions and records retention, and keep financial collection separate from informational value.

## SCH-02 Signature record is not externally certified

Priority P1. Evidence status Confirmed design limitation.

Record uses authenticated account identity, saved vectors/consent/time and a SHA-256 of terms. It has no trusted timestamp provider, external signing certificate, or independent tamper-evident record store.

Proposed work. Decide required evidentiary assurances with counsel and implement appropriate durable audit/export controls. Preserve legacy acceptance records accurately.

## ARCH-01 Large inline-JS owner workspace

Priority P1. Evidence status Confirmed maintainability gap.

About 155 KB of raw HTML includes many UI and business functions. TypeScript does not analyze those inline scripts. Owner payload validation is broad for some nested sample records.

Proposed work. Extract shared typed domain logic and modules incrementally; preserve callers and existing saved state. Strengthen relevant validation and add missing entry-point tests.

## ARCH-02 Whole-document saves and broad list queries

Priority P2. Evidence status Confirmed design; no load test.

Every owner edit rewrites a revisioned JSON blob, capped at one million request characters. Some lists use fixed 500/1000/5000 limits without UI pagination. User counts and peak concurrency were not measured.

Proposed work. Normalize transactional records, paginate bounded endpoints, evaluate query plans and load-test realistic club usage. Retain optimistic conflict protection.

## OPS-01 No verified independent staging, monitoring or full recovery drill

Priority P1. Evidence status Unverified / incomplete source evidence.

Current published URL is live; no isolated staging, alerting, incident runbook, retention schedule or independent production recovery test was verified.

Proposed work. Provision separate test services and credentials, add monitoring, backups, operational ownership and launch acceptance checks.

## DOC-01 Original docs and setup wrappers are stale

Priority P2. Evidence status Confirmed discrepancies.

README retains starter instructions and old pricing notes; SECURITY narrows Advance approval to grades 7-8. install:ci invokes a Linux Bash wrapper despite older portability claims.

Proposed work. Adopt the handoff docs into the main repository only after review, verify a fresh portable install, and align scripts with the documented package manager.

## DEMO-03 Admin-demo form sandbox needs browser review

Priority P2. Evidence status Static-review concern, not reproduced.

The admin-demo CSP enables scripts/modals but omits allow-forms, while several demos use form submit handlers. The signing sample explicitly allows forms and blocks network requests.

Proposed work. Exercise admin-demo form submissions in supported browsers and confirm desired sandbox behavior. Keep real owner APIs inaccessible from the public demo.

## SEC-03 Security validation scope is incomplete

Priority P2. Evidence status Unverified / static risks.

No penetration test, full dependency/dev graph review or production load test was performed. Some handlers enforce body size after reading text, and public/invite endpoint abuse controls need assessment.

Proposed work. Review body limits, rate limiting, CSP, logging/PII retention and abuse scenarios before accepting production data at scale.
