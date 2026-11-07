# How we work together

Lauren and Justin both work in this repo, often with Claude Code. Everything goes through issues and pull requests so either of us can see what is happening and why.

## The flow

1. **Start from an issue.** Every change has an issue. If there isn't one, create it first using the Task or Bug template.
2. **Assign yourself** on the issue before starting, so we never build the same thing twice.
3. **Branch from the latest `main`** using the issue number:
   - `feat/18-stripe-checkout` for new features
   - `fix/32-demo-fonts` for bugs
   - `chore/30-ci` for tooling and maintenance
   - `docs/12-launch-plan` for documentation
4. **Commit small, clear steps.** First line says what changed, in plain words, under about 70 characters.
5. **Open a pull request** with the template. Put `Closes #<issue>` in the description so the issue closes on merge. If the issue's "Done when" needs a real-world check after merging (a Stripe test-card run, a live email), write `Part of #<issue>` instead, in the description and in commit messages, because GitHub also closes issues named with "Closes" in commit messages.
6. **Checks must pass.** Tests, typecheck, build, the production audit, the browser walkthrough and the payment rehearsal run automatically on every pull request.
7. **The other person reviews.** Lauren reviews Justin's work and Justin reviews Lauren's. Nobody merges their own pull request without a review.
8. **Squash and merge**, then delete the branch.
9. **Publishing is automatic.** Once the Deploy workflow is switched on, every merge to `main` that passes all checks is published to the academy's Cloudflare account, after an encrypted backup of the live database. Check the Deploy run, then note on the issue that it is live.

## Decisions

Business decisions are issues labeled `needs-decision`. Record the decision as a comment on the issue, then close it. Code never encodes a policy that has not been decided there.

## Labels

| Label | Meaning |
|---|---|
| `who: justin` | Only Justin can do or decide this: the academy's accounts (Cloudflare, Stripe, Resend) and business decisions |
| `who: lauren` | Lauren does this: settings, accounts, email, review and merge |
| `who: claude` | Code work a Claude Code session can do |
| `P0` | Blocks launch |
| `P1` | High business or operational risk |
| `P2` | Maintainability or a later improvement |
| `after-launch` | Not needed to launch; do it after families are on the site |
| `in-progress` | Someone, or someone's Claude, is building it now. Check the linked pull request before starting |
| `needs-decision` | Waiting on an owner or business decision |
| `blocked` | Cannot start until something else is done |
| `area: auth`, `area: data`, `area: infra`, `area: owner workspace`, `area: payments`, `area: roster`, `area: scholarships` | Which part of the platform it touches |
| `bug`, `enhancement`, `chore`, `documentation` | What kind of change it is |

An issue can carry more than one `who:` label when people share it.

## Milestones

There is one milestone, **Launch** (Friday, November 13). Everything needed before families join is in it; [the Launch board (#246)](https://github.com/laurendarrah/savage-wrestling-academy/issues/246) lists it by person. Work for later is labeled `after-launch` instead.

The plan, with dated updates, is in [docs/LAUNCH_PLAN.md](docs/LAUNCH_PLAN.md). When a plan changes, update that file in the same pull request as the work that changed it. Every other document is listed in [docs/README.md](docs/README.md).

## Working with Claude Code

- Start a session on this repository and name the issue: "Work on #18."
- Claude Code reads [CLAUDE.md](CLAUDE.md) automatically. Those rules apply to people too.
- Ask it to branch, run `pnpm test`, `pnpm typecheck` and `pnpm build`, and push. Review its pull request like anyone else's.
- Each of us uses our own Claude and GitHub accounts. Never share logins.
- We often have more than one Claude working at once. Issues a Claude session can pick up are labeled `who: claude`. Before starting, ask yours to check the open pull requests and the `in-progress` label, and to add that label to the issue it picks up. If two pull requests touch the same page, merge one, then have the other rebased before merging it.
- Changes you make on the owner dashboard (programs, schedules, events) are saved straight to the live site and are never overwritten by code changes.

## Definition of done

- The issue's "Done when" is true.
- New or changed behavior has a test in `tests/`. Inline JavaScript in `.html` files needs a test because the typecheck skips it.
- Checks pass, the other person approved, and the change is merged.
- If it affects families or staff, it is published and verified on the live Site.

## Never

- Edit or publish the site anywhere but through GitHub (the old ChatGPT Sites project is retired).
- Push straight to `main`.
- Commit secrets, `.env` files or production data.
- Run anything against the production database or production Supabase project from a development machine.
