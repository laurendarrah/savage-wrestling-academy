# Verification record and limits

Review date November 5, 2026. The reviewed commit is bf444860637d6fc94fbd0342bf7ba0963ed0f178. This review made no application changes, deployment, hosted environment change, account creation, production data mutation or payment.

## Evidence obtained

- Exact tracked source archive, 252 files, file sizes and SHA-256 manifest.
- Local Git HEAD, clean working tree, 73 commits, no remotes and non-shallow state.
- Sites version 70 and successful deployment metadata pointing to the same source commit.
- Hosted environment variable names with secret values excluded.
- Supabase project health and security-advisor warning metadata.
- Stripe test account, nine active prices and disabled webhook configuration using read-only APIs.
- All 18 existing test scripts passed in an isolated source copy using the already installed dependencies.
- TypeScript non-incremental check and portable production build passed in that copy.
- All 13 migrations replayed against empty SQLite to derive the 15-table schema.
- Production-dependency audit returned eight advisories. Raw results are in evidence/dependency_audit.json.
- Public demo/calendar/signature pages were inspected in browser and screenshots captured.
- Additional isolated reproduction confirmed finishEvent throws ReferenceError for undefined annual.

## Important limits

Tests primarily use VM mocks and isolated SQLite. Passing tests do not establish production email, MFA recovery, payment fulfillment, camera access or browser compatibility. No clean installation or full browser end-to-end suite was run. Existing installed dependencies were linked into the separate validation directory. A full dependency audit including runtime-relevant devDependencies was not completed. Advisory reachability in the deployed Vinext build is unassessed.

Production D1 rows and migration state were not queried. Supabase redirect settings, email provider delivery, full authentication configuration, backups, paid plan, retention and production recovery were not inspected. Actual accepted scholarships, family counts and saved test-key state were not accessed. No live owner or family session was used.

GitHub synchronization, canonical GitHub ownership, external CI/CD, standalone Cloudflare account access and untracked historical assets cannot be confirmed from this checkout. No remote is configured. The Sites deployment provenance matches the inspected commit, which verifies the current deployed source reference but does not prove every external operational dependency is in Git.

A source-pattern scan found no obvious live secret values in tracked files. This is not a full Git-history secret audit. Service-managed secret values were deliberately not retrieved. Source includes non-secret service identifiers and synthetic test data.

Original README and SECURITY.md contain stale statements, documented in the issues list. New documentation in this package supersedes those descriptions for handoff purposes while the archived source remains unchanged.

## Reproduce the additional bug

From the source directory with Node available, run `node ../docs/reproductions/sample-event-reference-error.mjs`. The script reads app/portal.html and runs only an isolated sample VM. It reports the undefined annual variable in finishEvent. It does not request a live endpoint or modify the source.

The existing test result list is evidence/tests.json. Individual stdout files are evidence/test_logs. Typecheck stdout is empty because the command passed without diagnostics. Build stdout and audit output are included separately.
