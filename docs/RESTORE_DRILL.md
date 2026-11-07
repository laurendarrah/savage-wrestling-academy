# Restore drill (#25)

Proves that an encrypted backup Justin downloads from **Backups** can bring every record back. Lauren runs it with Claude on her own computer, restoring the file into a **local** copy of the site. Production is never touched: the local copy has no Cloudflare login, no Supabase project, no Stripe key and no email key, so it can't reach the live site, its database, families' inboxes or USA Wrestling.

**Done when:** the restored record counts match the file for every table, and the result is posted on #25.

## What you need

- **Justin's backup file** (`savage-backup-<date>.savage`), downloaded on the live site's **Backups** page, and **its passphrase**. Justin types the passphrase himself, or shares it through the password manager. Never in an email, chat, issue or file. The helper asks for it at a hidden prompt and never saves it.
- **The live numbers from the same moment.** When Justin downloads the file, he writes down what the live site shows: **Family accounts** (`/accounts`): "N families · M wrestlers"; **Waivers**: how many signed. Families who join after the download won't be in the file.
- **Lauren's computer** with this repository on an up-to-date `main`, Node 22.13 or newer and Corepack, then once:

  ```bash
  pnpm install --frozen-lockfile
  pnpm exec playwright install chromium
  ```

## Steps

1. **Start the drill.** In a terminal in the repository:

   ```bash
   pnpm restore:drill
   ```

   It builds the site, creates a brand-new local database, starts the site at `http://127.0.0.1:8798` and opens a Chromium window on **Backups**, already signed in as the local owner. This takes a minute or two.

2. **Restore the file in that window.** Under **Preview and restore a backup**: choose the file, type the passphrase, choose **Unlock & preview**.
   - [ ] *You see "Backup made <date and time> · N family profiles · … payments · … check-ins · … signed waivers · …".* Write the line down. The date is when Justin downloaded it.
   - Choose **Restore these saved records**, then **OK**.
   - [ ] *"Backup restored. Missing records added back: …".*

3. **Look around the local copy** (optional, same window): `/accounts` shows "N families · M wrestlers" matching Justin's live numbers, and `/payments`, `/roster` and `/waivers` show the academy's records. Nothing you do here reaches anyone: email, card payments and USA Wrestling checks are switched off.

4. **Compare every table.** Back in the terminal, press Enter, then give the file (drag it into the terminal window) and type the passphrase again. It opens the file the same way the Backups page does and counts every table in the local database:

   ```
   Table                        In file     Local  Result
   academy_settings                   3         3  match
   family_accounts                   42        42  match
   orders                           118       118  match
   security_events                  950         -  not restored  (…)
   …
   Every table came back. Record the result on issue #25.
   ```

   - [ ] **Every table says `match`.** `more here` is fine for `academy_settings`: the local site writes a few markers of its own. `security_events` always says `not restored`: Security activity is in the file for safekeeping but is never restored, so the log can't be rewritten from a file.
   - [ ] **`Academy settings: in the file and restored.`**
   - Any `MISSING`: keep the file, don't delete anything, and tell Lauren. Write down which tables.

5. **Stop.** Press Enter. The drill stops the local site and deletes the local copy (`.wrangler/restore-drill`), which held real family records.

6. **Post the result on #25:** the date, the "Backup made …" line, "Every table came back" (or which tables didn't), and that the family count matched Justin's live number. No family names, emails or card numbers, and never the passphrase.

## How the local copy works

For Claude, or anyone curious. Everything here runs on Lauren's computer only.

- **`pnpm dev`** starts the Vite dev server on port 5173. Its database is a local D1: a SQLite file Miniflare keeps under `.wrangler/state`. It starts empty, with no tables, until the migrations in `drizzle/` are applied (README, "Getting started"). Signed-in pages need a Supabase project (`.env.local`, from a development project, never production). Without one, every signed-in page refuses.
- **The drill doesn't use `pnpm dev`.** It runs the built Worker the way the browser walkthrough does (`scripts/e2e/run.sh`): `pnpm build`, then every `drizzle/*.sql` file into a fresh local D1 in `.wrangler/restore-drill`, then `wrangler dev --local` against it. The starter programs are removed, so the academy settings come only from the file.
- **Sign-in** uses the walkthrough's stand-in for Supabase (`scripts/e2e/fake-supabase.mjs`) on `127.0.0.1:54341`. The site is started with `SUPABASE_URL` pointing at it, any `sb_publishable_` value as `SUPABASE_PUBLISHABLE_KEY`, and `APP_ORIGIN=http://127.0.0.1:8798`. The stand-in answers for the owner email with a verified authenticator, which is what an owner sign-in needs, and the drill puts that session's cookie in the Chromium window.
- **Nothing gets out.** The drill sets `EMAIL_API_KEY`, `MAIL_FROM`, `CHECKOUT_KINDS` and the Stripe secrets to empty, even if a `.dev.vars` file has them, and points `USAW_LOOKUP_BASE` at a closed local port so no card number leaves the computer. The saved Stripe key is never in a backup. Scheduled jobs (morning reminders) don't run under `wrangler dev`.
- **The comparison** (`scripts/restore-drill-check.mjs`, tested in `tests/restore-drill.mjs`) reads the row count of every section in the file and counts the matching table with `wrangler d1 execute --local`.

Options: `pnpm restore:drill -- --port 8800 --auth-port 54350` if those ports are taken; `--no-build` to reuse the last build; `--keep` to leave the local copy for a closer look (then delete `.wrangler/restore-drill` yourself).

## If something goes wrong

- **"Could not open Chromium":** run `pnpm exec playwright install chromium` once.
- **"The local site did not start":** another program may be using the port. Try `--port 8800 --auth-port 54350`. The message ends with the site's own log.
- **"The passphrase is incorrect or the backup file is damaged":** check the passphrase with Justin. A file that was cut short (a download that didn't finish) can't be opened; download a new one.
- **"This is not a supported backup for this academy":** the file isn't a Savage Wrestling Academy backup.
- **Stopped halfway** (closed the terminal, Ctrl+C): the drill stops what it started. If `.wrangler/restore-drill` is still there, delete it.

## Also possible: the Deploy workflow's backup

Every Deploy saves an encrypted SQL copy of the live database first (GitHub → **Actions → Deploy** → the run → **Artifacts**, kept 30 days; `docs/RUNBOOK.md`, "Data looks wrong or is missing"). It is a different format from the Backups page file and needs `BACKUP_PASSPHRASE`. To check one locally, decrypt it with the `openssl` command in `docs/GO_LIVE.md` ("Rolling back") into a file outside the repository, and import it into a new local database only, with `--local --persist-to` a fresh folder. Delete the decrypted file and the folder afterwards.
