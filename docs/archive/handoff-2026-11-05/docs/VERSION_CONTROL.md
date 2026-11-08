# Version control and provenance

The inspected original checkout is clean and its HEAD is bf444860637d6fc94fbd0342bf7ba0963ed0f178. It is not shallow and contains 73 local commits. Sites version 70 records the same commit; the associated deployment reports succeeded. This verifies alignment of the inspected committed source with the latest published version's provenance.

`git remote -v` and the remote URL configuration query returned no configured remotes in this checkout. No GitHub repository URL, GitHub Actions workflow, or verified GitHub mirror was found. The code is committed locally and its deployed Sites version has matching source provenance. A current complete copy committed to GitHub cannot be confirmed from the available evidence.

The package's source folder is a Git archive of all 252 tracked files at HEAD. It deliberately preserves the original source README and SECURITY document rather than silently rewriting application repository files during a read-only review. New handoff documentation lives at the package root and in docs. Git history is not bundled; historical commits were not scanned for secrets. Justin must provide canonical repository access or authorize a separate secure history export if history is needed.

## Included and excluded dependencies

| Item | Included | Continuation requirement |
|---|---|---|
| App source, tests, config, build integration, vendor files, public assets | Yes, exact tracked snapshot | Verify source hashes against docs/source-manifest.json |
| pnpm lockfile, workspace policy and package manifest | Yes | Reinstall dependencies with the pinned package manager |
| node_modules and native platform binaries | No | Clean installation on the target machine remains unverified |
| .sites-runtime execution profile and cache | No | Clean clones default to portable; managed Sites helpers select the managed profile |
| .wrangler and database contents | No | Provision a separate local D1 DB and apply migrations; production data access must be arranged separately |
| Supabase users, sessions, MFA factors and email settings | No | Owner-managed Supabase configuration and access |
| Hosted environment secret values and encrypted Stripe credential | No | Secure owner-controlled provisioning; preserve wrapping-key recovery |
| Sites source credentials and publication helpers | No | Supplied by the Sites platform, outside the application repository |
| Live tenant settings, schedules, family/award records and signatures | No private data dump | Public observations are documented; the runtime data store is not the source repository |
| Generated dist/server deployment output and prior tar archives | No | Rebuild from source; the isolated build passed |
| Domain registrar/GoDaddy configuration and other prior design files | No | Not verified or needed for the current source build; coordinate separately for migration |

No common hard-coded secret pattern was found in the current tracked snapshot. This heuristic scan is limited to selected private-key, Stripe-secret, Supabase-secret, GitHub-token and JWT patterns. It is not a guarantee that the repository, dependencies, history or service configuration are free of secrets or vulnerabilities.

Source history uses broad Update Site source commits, so feature-level authorship and exact AI provenance are not fully reconstructible from commit subjects. There is no verified automated CI/CD, branch protection, release approval process or collaborator access policy in GitHub.
