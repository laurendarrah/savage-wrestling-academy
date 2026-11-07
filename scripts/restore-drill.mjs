// The restore drill (issue #25, docs/RESTORE_DRILL.md) in one command: pnpm restore:drill
//
// 1. Builds the site and starts it on this computer, on a brand-new local database in .wrangler/restore-drill. Never
//    production: it has no Cloudflare login, no Supabase project, no Stripe key and no email key, so nothing can reach
//    the live site, its database, families' inboxes or USA Wrestling.
// 2. Signs a browser window in as the local owner, with the walkthrough's stand-in for Supabase sign-in
//    (scripts/e2e/fake-supabase.mjs), and opens Backups. You restore the file there with its passphrase.
// 3. Asks for the file and its passphrase again here (typed, never shown, saved or passed on the command line), opens the
//    file the same way the Backups page does, and compares every table's rows with the local database.
// 4. Stops everything it started and deletes the local copy, which holds the academy's real records.
//
// Options: --port (default 8798), --auth-port (54341), --no-build, --headless (no window: for checking the script itself),
// --keep (leave the local copy in .wrangler/restore-drill).
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, readdirSync, rmSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {start, sessionCookie} from './e2e/fake-supabase.mjs';
import {openBackupFile, countSql, compareCounts, report} from './restore-drill-check.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const args = process.argv.slice(2), flag = n => args.includes('--' + n), opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt('port', 8798)), AUTH_PORT = Number(opt('auth-port', 54341)), PERSIST = '.wrangler/restore-drill';
const BASE = `http://127.0.0.1:${PORT}`, AUTH = `http://127.0.0.1:${AUTH_PORT}`;
const wrangler = ['--import', './scripts/local-env.mjs', './node_modules/wrangler/bin/wrangler.js'];
const local = ['--local', '--config', 'dist/server/wrangler.json', '--persist-to', PERSIST];
const say = s => console.log(s);

let server = null, auth = null, browser = null;
async function stop() {
  try { await browser?.close(); } catch {}
  // The local site runs in its own process group (detached), so stopping the group stops Wrangler and the runtime it started.
  if (server && server.exitCode === null) {
    const gone = new Promise(r => server.once('exit', r));
    try { process.kill(-server.pid, 'SIGTERM'); } catch { try { server.kill(); } catch {} }
    if (await Promise.race([gone.then(() => true), new Promise(r => setTimeout(() => r(false), 5000))]) === false) { try { process.kill(-server.pid, 'SIGKILL'); } catch {} }
  }
  try { auth?.close(); } catch {}
  if (!flag('keep')) rmSync(PERSIST, {recursive: true, force: true});
}
process.on('SIGINT', async () => { say('\nStopping…'); await stop(); process.exit(130); });

function run(cmd, list, quiet = true) {
  const r = spawnSync(cmd, list, {stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8'});
  if (r.status !== 0) throw Error(`${cmd} ${list.join(' ')} failed:\n${(r.stderr || r.stdout || '').slice(-2000)}`);
  return r.stdout;
}
const d1 = (...more) => run(process.execPath, [...wrangler, 'd1', 'execute', 'DB', ...local, ...more]);

const query = sql => JSON.parse(d1('--json', '--command', sql))[0]?.results ?? [];

function ask(question, hidden = false) {
  return new Promise(resolve => {
    const rl = createInterface({input: process.stdin, output: process.stdout, terminal: true});
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(question); };
    rl.on('SIGINT', () => { rl.close(); process.emit('SIGINT'); });
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
  });
}

try {
  say('Restore drill: a local copy of the site on this computer only. Never production.\n');
  if (!flag('no-build')) { say('1. Building the site…'); run('pnpm', ['build']); }
  if (!existsSync('dist/server/wrangler.json')) throw Error('No build found. Run without --no-build.');
  say('2. Creating a brand-new local database in ' + PERSIST + '…');
  rmSync(PERSIST, {recursive: true, force: true});
  for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) d1('--file', 'drizzle/' + f);
  // Like the walkthrough (scripts/e2e/run.sh): no starter programs, so the academy settings come only from the file.
  d1('--command', "DELETE FROM academy_state WHERE updated_by LIKE 'setup:issue-%'");

  say('3. Starting the local site on ' + BASE + '…');
  auth = await start(AUTH_PORT);
  // Every setting that could reach the outside is set empty here, even if a .dev.vars file has one. USA Wrestling's
  // verify page points at a closed local port, so no card number leaves this computer.
  const vars = {SUPABASE_URL: AUTH, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_restore_drill', APP_ORIGIN: BASE, USAW_LOOKUP_BASE: 'http://127.0.0.1:9',
    EMAIL_API_KEY: '', MAIL_FROM: '', CHECKOUT_KINDS: '', STRIPE_MODE: 'test', STRIPE_TEST_WEBHOOK_SECRET: '', STRIPE_LIVE_WEBHOOK_SECRET: '', STRIPE_CONFIG_ENCRYPTION_KEY: '', STRIPE_ACCOUNT_ID: ''};
  server = spawn(process.execPath, [...wrangler, 'dev', ...local, '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', '0',
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], {stdio: ['ignore', 'pipe', 'pipe'], detached: true});
  let log = ''; server.stdout.on('data', d => { log = (log + d).slice(-4000); }); server.stderr.on('data', d => { log = (log + d).slice(-4000); });
  let up = false;
  for (let i = 0; i < 90 && !up; i++) { try { up = (await fetch(BASE + '/calendar')).ok; } catch {} if (!up) await new Promise(r => setTimeout(r, 1000)); }
  if (!up) throw Error('The local site did not start:\n' + log);

  say('4. Opening Backups, signed in as the local owner…');
  const {chromium} = await import('playwright');
  try { browser = await chromium.launch({headless: flag('headless')}); }
  catch { throw Error('Could not open Chromium. Run "pnpm exec playwright install chromium" once, then try again.'); }
  const context = await browser.newContext({viewport: {width: 1100, height: 900}});
  const cookie = sessionCookie('owner', AUTH);
  await context.addCookies([{name: cookie.name, value: cookie.value, url: BASE}]);
  const page = await context.newPage();
  await page.goto(BASE + '/backups');
  say(`
   In the browser window (${BASE}/backups):
   - Under "Preview and restore a backup", choose the encrypted backup file and type its passphrase.
   - Choose "Unlock & preview", note the counts it shows, then "Restore these saved records" and OK.
   - Wait for "Backup restored."
`);
  await ask('   Press Enter here once the page says "Backup restored." ');

  say('\n5. Comparing the file with the local database.');
  const file = (await ask('   Backup file (drag it into this window, or type its path): ')).trim().replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ');
  if (!existsSync(file)) throw Error('No file at ' + file);
  const passphrase = await ask('   Its passphrase (not shown as you type): ', true);
  const opened = await openBackupFile(path.resolve(file), passphrase);
  say(`   Backup made ${new Date(opened.createdAt).toLocaleString('en-US', {timeZone: 'America/New_York'})} (New York time), version ${opened.version}.`);
  const tables = query("SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name);
  const sql = countSql(tables), counts = {};
  for (const [t, n] of Object.entries(sql ? query(sql)[0] ?? {} : {})) counts[t] = Number(n);
  const academy = query("SELECT count(*) AS n FROM academy_state WHERE id='academy'")[0]?.n > 0;
  const result = report(compareCounts(opened.rows, counts));
  say('\n' + result.lines.map(l => '   ' + l).join('\n'));
  say(`\n   Academy settings: ${opened.academy ? (academy ? 'in the file and restored' : 'in the file but NOT restored') : 'not in this file'}.`);
  say(result.ok && (academy || !opened.academy)
    ? '\n   Every table came back. Record the result on issue #25.'
    : `\n   Not everything came back: ${result.missing.join(', ') || 'academy settings'}. Keep the file and tell Lauren before going further.`);
  await ask('\nPress Enter to stop the local site and delete the local copy. ');
} catch (e) {
  console.error('\n' + (e?.message || e));
  process.exitCode = 1;
} finally {
  await stop();
  say(flag('keep') ? 'Stopped. The local copy is still in ' + PERSIST + '; delete it when you are done.' : 'Stopped. The local copy is deleted.');
  process.exit(process.exitCode ?? 0);
}
