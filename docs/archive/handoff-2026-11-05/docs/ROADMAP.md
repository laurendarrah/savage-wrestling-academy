# Prioritized development roadmap

Complexity is relative, not a time or cost estimate. S is a bounded fix, M spans several components, and L changes the transactional model or external integrations. Dependencies matter more than the order of the visual menu.

| Work | Priority | Complexity | Depends on | Acceptance condition |
|---|---|---|---|---|
| Triage package advisories and deployed runtime reachability | P0 | M | Exact source/build baseline | Patched/removed dependencies or documented non-reachability, full relevant regression and build audit |
| Correct callback origin and verify email/MFA lifecycle | P0 | M | Controlled Supabase dev configuration | Signup, verification, login, recovery, password change, logout and protected roles work on intended origins |
| Establish isolated staging and least-privilege developer access | P0 | M | Owner-controlled service access | Changes and test charges cannot modify the live data environment accidentally |
| Complete backup and signature retention/recovery | P0 | M | D1 schema inventory, wrapping-key custody | All required records recover into a clean environment; accepted contracts survive termination and recovery |
| Unify athlete, family, enrollment and entitlement identities | P0 | L | Data migration design | Owner directory/roster, real family portal, scholarship and paid access use stable linked IDs |
| Finalize ordinary and scholarship agreements | P0 | External policy work | Owner/counsel review | Clear term, pricing, early exit, notices, privacy and signature procedures are approved before binding enrollment |
| Implement test checkout and immutable order records | P1 | L | Unified identity, policy, test credentials | Server-calculated amounts and snapshotted policy/discount choices produce safe retryable test sessions |
| Implement signed webhook and reconciliation lifecycle | P1 | L | Checkout/order model | Valid signatures/account/mode, replay protection, idempotent fulfillment and out-of-order handling are proven |
| Implement fixed 12-installment and upfront entitlements | P1 | L | Stripe lifecycle and canonical memberships | First payment counts toward 12; no 13th charge; end-of-month/leap dates, failures, cancellation and manual continuation are tested |
| Replace sample billing cards with actual records | P1 | M | Orders, subscriptions and receipts | Correct last payment, next installment, term end, failure status and receipts per wrestler |
| Implement operating roster, waiver/card evidence and QR check-in | P1 | L | Real entitlements and secure data handling | An eligible wrestler appears on the right session, a scan records once, and missing requirements produce an actionable staff review |
| Connect added practices, camps and capacity | P1 | M/L | Orders, entitlements and transactional holds | Correct member pricing, date/grade eligibility, seat limits, holds, cancellations and no duplicate enrollment |
| Connect private lesson booking to real coach openings | P1 | L | Capacity, payments and coach identities | No double booking; actual time/coach assignment and supported shared-participant lifecycle |
| Implement general scoped messaging and delivery | P1 | M/L | Real family directory and consent policy | Sender/recipient isolation, opt-ins, channel delivery and failure visibility are verified |
| Fix sample event error and grade-rule drift | P1 | S/M | Known reproduction and shared domain rules | Both real and demonstration entry points pass regression tests and communicate their actual status |
| Refactor raw HTML logic and improve entry-point tests | P1/P2 | M/L | Behavior inventory and data model | Shared typed rules replace duplicated logic; critical UI workflows run in browser integration tests |
| Improve observability, audit coverage, pagination and CI | P2 | M | Stable services and version-control home | Pull-request checks, deployments, alerts, error ownership and load thresholds are defined and measured |
| Implement financial reporting / coach settlement if required | P2 | L | Verified financial model and reconciliation | Fees, refunds, payouts, receipts and business reporting reconcile to actual transactions |
| Complete website/domain migration and launch rehearsal | P2 | M | Production acceptance of account and transaction flows | Correct links/domain/callbacks, mobile/browser checks, operator training, small-group rehearsal and rollback plan |

## Payment implementation requirements

Use the existing server grade/approval checks and recompute prices from saved configuration. A recurring Stripe Price alone is insufficient to implement a fixed 12-month commitment. Choose and test a bounded schedule, renewal/termination semantics and invoice accounting before live billing. Handle asynchronous success/failure, duplicate and unordered events, refunds, disputes and fraud warnings. Do not grant paid access from a browser success redirect.

Stripe test mode is the only verified account context. No live charge authorization, live keys or live purchases were part of this review. Before live operation, verify tax obligations, receipts, cancellation rights and all required contract notices with the appropriate business/legal review.

## Suggested first collaborator session

Run the shipped tests and the sample event reproduction, read the architecture and feature matrix, compare the real /family and /accounts services with the sample admin directory, and review the canonical identity/entitlement model before committing to a production estimate. Then agree with Justin on the first isolated milestone and its acceptance checks.
