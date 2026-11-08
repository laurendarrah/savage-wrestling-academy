# Docs

Every document in the repository, one line each. Marked *historical* means kept for the record; it no longer describes the site. Open work lives in GitHub issues, on the [Launch board (#246)](https://github.com/laurendarrah/savage-wrestling-academy/issues/246), not in these files.

## Start here

- [README](../README.md): what the site is, how to run it locally, where things are.
- [CONTRIBUTING](../CONTRIBUTING.md): how we work: issues, branches, pull requests, labels, several Claude sessions at once.
- [CLAUDE.md](../CLAUDE.md): the rules Claude Code follows, and people too. Read the hard rules before changing anything.
- [FEATURE_STATUS](FEATURE_STATUS.md): what the site does today, feature by feature, and what each still waits on.

## Running the site

- [GO_LIVE](GO_LIVE.md): moving to the academy's Cloudflare account, Worker settings, Supabase and Stripe set-up, cut-over to the real address.
- [RUNBOOK](RUNBOOK.md): what to do when something goes wrong, for the owner and whoever helps.
- [LAUNCH_TEST_PASS](LAUNCH_TEST_PASS.md): the printable test pass Justin and Lauren run on the live site in Stripe test mode before families join (#24).
- [RESTORE_DRILL](RESTORE_DRILL.md): proving a downloaded backup restores, into a local copy with `pnpm restore:drill` (#25).
- [email-templates](email-templates/README.md): the Savage-branded sign-in emails to paste into Supabase.

## Architecture and data

- [ARCHITECTURE](ARCHITECTURE.md): how the Worker, D1, Supabase, Stripe and the pages fit together, who can do what, and the tests.
- [SCHEMA](SCHEMA.md): every database table and how to add a migration.
- [API_REFERENCE](API_REFERENCE.md): every API route and page, by who can use it.
- [SECURITY](../SECURITY.md): the access model, backups and encryption, and the security tests.
- [DEPENDENCY_ADVISORIES](DEPENDENCY_ADVISORIES.md): what `pnpm audit` reports and why anything left is acceptable.

## Policies (drafts for the attorney)

None of these is published or legal advice. [policies/README](policies/README.md) explains the markers and what each unblocks.

- [Privacy policy](policies/privacy-policy-draft.md)
- [Refund and cancellation policy](policies/refund-policy-draft.md) for walk-ins, Friday Night Live, camps and lessons
- [Data retention](policies/data-retention-draft.md)
- [Membership terms checklist](policies/membership-terms-checklist.md)
- [Parent Consent Form](policies/parent-consent-form-draft.md)

## Decisions and history

Decisions themselves live in issues labeled `needs-decision`.

- [LAUNCH_PLAN](LAUNCH_PLAN.md): the launch plan written November 5 with dated updates, the manual stand-ins and what replaced them, and the handoff roadmap's status. The one plan: update it in the same pull request when a plan changes.
- [ISSUES](ISSUES.md): the November 5 handoff review's 21 findings and where each one went.
- [SITES_V131_TRIAGE](SITES_V131_TRIAGE.md): *historical.* Justin's ChatGPT Sites versions 71 to 131, entry by entry, and where each went (#187).
- [archive/handoff-2026-11-05](archive/handoff-2026-11-05/README.md): *historical.* The November 5 handoff package: review PDF, original docs, evidence and test logs, screenshots, manifests.
