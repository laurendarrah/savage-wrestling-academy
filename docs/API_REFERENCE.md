# Route reference

This inventory is extracted from the reviewed app/api route files. Mutations generally use JSON, same-origin validation and the route-specific account/MFA guard. This is a review map, not a replacement for request schemas and action unions in each route. Read the route and its lib helper before writing a client. Never infer authorization from a hidden navigation link.

| Route | Methods | Purpose and access |
|---|---|---|
| /api/academy | GET, PUT | Owner-only shared academy configuration/sample operational state, optimistic revision writes. |
| /api/approval-chat | GET, POST | Owner or matching family thread participants. Bounded messages, pagination and rate limiting. |
| /api/auth | GET, POST | Supabase identity/session status and sign-in, signup, resend, reset, password and sign-out actions. Action-specific guards and rate limits. |
| /api/backups | GET, POST | Owner encrypted-export/restore support for the limited legacy dataset. Does not cover all tables. |
| /api/booking-review | POST | Verified family event/lesson/Friday Live review. No booking, payment or reservation. |
| /api/coach | GET, POST | Active MFA coach identity, assigned programs, availability openings. |
| /api/family | GET, PUT | Verified account profile read/update with account scoping and revision checks. |
| /api/owner-approvals | GET, POST | Owner decisions on pending program approvals. |
| /api/payment-setup | GET, POST | Owner reads status or validates and encrypts restricted Stripe test key. Checkout remains disabled. |
| /api/practice-curricula | GET, POST | Owner manages curriculum groups and ordered lessons. |
| /api/practice-plans | GET, POST | Owner authors and publishes, assigned coach reads eligible published plans. |
| /api/program-approvals | GET, POST | Family-scoped Advance approval requests and status. |
| /api/public-schedule | GET | Public sanitized monthly projection. No-store and cross-origin read allowed. |
| /api/registration | GET, POST | Public configuration plus authenticated wrestler/program registration review. Payments disabled. |
| /api/scholarship | GET, POST | Token-based offer review, matching verified recipient acceptance with frozen terms and signature. |
| /api/scholarships | GET, POST | Owner lists, creates, revises, rotates, revokes and ends awards. |
| /api/security | GET, POST | Session/MFA enrollment and challenge actions. Not a public security-log API. |
| /api/staff | GET, POST | Owner-only active coach assignments by email. |

Additional server-rendered pages include /accounts, /account-setup, /approvals, /backups, /curricula, /practice-plans, /payment-setup, /security-log, /security and /staff. Each protected page performs its own identity check. /auth/confirm completes the Supabase email flow. /scholarship-agreement returns an authorized printable accepted-agreement representation. It is not a public contract download.

The source contains no /api/stripe-webhook route and no checkout-session creation route. The registered Stripe webhook target does not imply a working handler. Most route implementations contain action dispatch inside POST rather than separate REST resource paths. API errors, ownership checks and accepted body shapes are directly testable in tests/*.mjs.
