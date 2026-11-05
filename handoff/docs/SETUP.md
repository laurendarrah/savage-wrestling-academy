# Setup and continued development

## What was validated

The reviewed source was exported to a separate directory, with a symlink to the existing installed dependency tree. All 18 test scripts, a non-incremental TypeScript check, and a portable-profile production build passed there. No clean dependency installation, alternate operating-system install, production database migration replay, real signup email, MFA challenge or payment was executed during this review.

## A new development checkout

Use the packaged `source/` directory or obtain access to the canonical Sites source repository from Justin. The snapshot has no Git object directory and no remote configuration. Preserve the reported base commit and hashes if importing it into GitHub. Create a separate development branch/environment before any implementation work.

The package requires Node >=22.13.0; Node 24.22.1 was used for this review. Prefer matching Node 24 and pnpm 11.25.0 initially, because the tests use node:sqlite and the project has version-specific build tooling. The package manifest and lockfile are authoritative for dependency versions.

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
```

A fresh installation was not attempted here. The local dependency audit reached the package registry successfully. Recheck the lockfile and platform build policies on the collaborator's machine.

The original README is stale. Its description of npm ci and Bash-free portability conflicts with the current `install:ci` entrypoint, which runs `bash scripts/install-pnpm.sh` and requires tools such as flock and timeout. A normal pnpm install is the practical starting point for a portable checkout; verify that it reproduces the lockfile before relying on it. Do not translate this established project to npm casually.

## Local configuration

Copy the package's `.env.example` into the new source checkout as `.env.local` and replace the placeholders with credentials for a separate development Supabase project. The Cloudflare Vite plugin supports .env or .dev.vars for local Worker env bindings. The existing .gitignore excludes .env files, but not .dev.vars, so do not put secrets in a tracked .dev.vars file. No production secret is included in this package.

Current application inputs are SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and, for Stripe credential storage, STRIPE_CONFIG_ENCRYPTION_KEY. The encryption key is 32 random bytes encoded as 64 hexadecimal characters. Keep the real wrapping key with the encrypted credential; changing it invalidates stored encrypted keys unless they are re-encrypted deliberately.

STRIPE_TEST_WEBHOOK_SECRET is configured in the hosted environment, but the current application does not read it. It does not enable webhooks or checkout. The restricted test API key is encrypted in D1 integration_secrets through the owner page, not supplied by a source file or a STRIPE_SECRET_KEY environment variable.

APP_ORIGIN and OWNER_EMAIL are source constants in lib/account-auth.ts. An environment variable of those names will not override them. The former currently points at the older wellrose34 hostname. A developer needs to make an intentional code/configuration change in their own branch and align the Supabase Site URL and redirect allowlist before testing local signup and recovery. The portable ChatGPT mock identity does not bypass Supabase owner authentication.

Official local-env reference, checked during review, https://developers.cloudflare.com/workers/local-development/environment-variables/

## Local schema and build

A clean exported checkout defaults to the portable profile, because the ignored execution-profile selection is absent. The build in this state passed with the existing dependencies. The tracked build integration simulates a local D1 binding named DB. There is no persistent root wrangler.jsonc in this project; the build emits dist/server/wrangler.json.

```sh
pnpm run build
```

For a new empty local D1 database, apply all SQL files under drizzle in filename order. Use the project's generated config and the same persistence directory. Apply each migration once; do not replay a migration already applied to that local database.

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_jazzy_silvermane.sql
```

Repeat the command with each next migration, ending at 0012_brainy_runaways.sql. The schema-only combined export in docs/schema.sql is useful for inspection or a new isolated schema, but the application migration history remains the 13 original files and Drizzle journal. Do not apply both paths to the same database.

```sh
pnpm run dev
```

In a portable checkout the development server starts on port 5173 unless changed. For a built local Worker, `pnpm start` uses Wrangler on loopback and .wrangler/state. Use the URL printed by the process. Secure-cookie and callback behavior on local development still needs end-to-end verification with the selected Supabase configuration.

## Tests and audit

There is no npm test script. Run each tracked test directly from the source root, or use the included non-mutating runner from this package.

```sh
node ../tools/run-tests.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
pnpm run build
pnpm audit --prod --json
```

The runner invokes the 18 scripts sequentially. They mostly use Node VM mocks and empty SQLite databases populated from migrations. They do not prove production email delivery, actual payments, browser camera compatibility, a full migration from the current site, or end-to-end customer operation.

The audit returned eight advisories in this review. Do not run audit fix blindly; Vinext compatibility and the actual deployed dependency graph require assessment. A full dependency and built-artifact audit is still needed, because some runtime-relevant framework packages are declared as devDependencies.

## Existing Sites development and publishing

Inside ChatGPT Work, the Sites integration owns source-repository credentials, source synchronization, version saving, production environment bindings and deployment. Its site-workflow, package and deployment helpers are platform tooling outside this repository. They were used during prior development, but no source credential was minted and no deployment was performed during this review.

The existing .openai/hosting.json already identifies this Site. Do not create a replacement Site accidentally. Reusing its project ID publishes to the current live application. For collaboration, obtain the appropriate Sites editor/source access from Justin and use an isolated environment until the changes are reviewed. Owner access inside the application is a separate Supabase/MFA permission.

For a standalone Cloudflare deployment, supply new Worker/D1 infrastructure and adapt the Sites dispatch/connector integration and secrets. That portability path has not been verified. Do not assume a plain next start, Vercel deployment, or GoDaddy upload is equivalent to the current Worker build.
