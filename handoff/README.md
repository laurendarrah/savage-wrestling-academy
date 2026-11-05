# Savage Wrestling Academy platform handoff

Prepared November 5, 2026 for a technical collaborator. This package is a source-verified review of the existing platform. It includes a complete tracked-source snapshot and new handoff documentation. The original application, accounts, database contents, and deployment were not changed during this review.

## Start here

1. Read `SWA_Project_Handoff_2026-11-05.pdf` for the complete review.
2. Read `docs/ARCHITECTURE.md` and `docs/FEATURE_STATUS.md` before estimating work.
3. Follow `docs/SETUP.md` in a separate development environment.
4. Review `docs/ISSUES.md`, `docs/ROADMAP.md`, and the dependency audit before enabling payments.
5. Use the public demos in `docs/DEMO_ACCESS.md` for initial evaluation.

## Current state

The platform combines working authenticated backend features with an extensive sample-data admin workspace. Public calendars, family profiles, coach openings, program approvals, approval chat, practice plans, curricula, and scholarships have implemented backend paths and isolated tests. Paid registration is a review flow. It cannot currently collect money or activate a paid membership. Camera attendance recognizes sample passes and does not record real QR attendance.

The admin workspace's sample wrestlers are stored separately from real family-account wrestlers. A sample membership, check-in, program transfer, message, or lesson payout must not be treated as a completed real-world transaction.

## Snapshot identity

| Item | Verified value |
|---|---|
| Source commit | `bf444860637d6fc94fbd0342bf7ba0963ed0f178` |
| Sites version | 70 |
| Live deployment | Succeeded; same source commit |
| Tracked source | 252 files, 2,433,614 bytes |
| Local Git history | 73 commits; not shallow |
| Configured Git remotes | None in inspected checkout |
| GitHub mirror | Not verified |
| Validation | All 18 existing test scripts passed; typecheck and build passed |
| Dependency audit | 8 advisories, including 2 critical; runtime reachability needs assessment |

## Package contents

- `source/` contains the exact tracked files from the reviewed commit, including the original README and security document. Their stale statements are called out in this review.
- `docs/` contains the updated project README-equivalent documentation, architecture, feature matrix, API reference, workflows, setup, schema, issues, roadmap, and access instructions.
- `.env.example` contains placeholders only. See the setup document before configuring local authentication.
- `evidence/` contains test results, build/typecheck logs, dependency audit, and sanitized service metadata.
- `docs/schema.sql` and `docs/schema.json` were derived by applying all 13 tracked migrations to an empty isolated SQLite database.
- `docs/source-manifest.json` identifies every source file and SHA-256 hash.
- `docs/reproductions/sample-event-reference-error.mjs` reproduces a confirmed sample camp/event review bug without accessing production.

Secrets, customer records, database dumps, authentication sessions, `node_modules`, generated build output, and Git object history are excluded. A source snapshot does not include the operational database or hosted secret values. Request account-specific access from Justin through the appropriate service.
