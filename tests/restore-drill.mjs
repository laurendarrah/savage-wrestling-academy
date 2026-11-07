// Issue #25: the restore drill's helper (scripts/restore-drill.mjs, docs/RESTORE_DRILL.md) opens a backup file the way the
// Backups page does and compares each table's rows with the local database. It only ever runs a local copy.
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {encryptLines, linesOf} from '../public/security-backup.js';
import {openBackupFile, countSql, compareCounts, report, tableFor} from '../scripts/restore-drill-check.mjs';

const PROJECT = 'appgprj_6ad13665e8c881918c12b096132b4cae', pass = 'correct horse battery staple';
const backup = {version: 3, project: PROJECT, createdAt: '2026-11-07T15:00:00.000Z', academy: {programs: []},
  families: [{user_id: 'u1', email: 'a@example.test', payload: {}}, {user_id: 'u2', email: 'b@example.test', payload: {}}], openings: [],
  records: {orders: [{id: 'o1'}, {id: 'o2'}, {id: 'o3'}], attendance: [{id: 'a1'}], academy_settings: [{id: 'x'}]},
  archive: {security_events: [{id: 's1'}, {id: 's2'}], truncated: false}};

// --- A real encrypted file, made by the Backups page's own code, opens with the passphrase and only with it ---
const dir = mkdtempSync(path.join(tmpdir(), 'restore-drill-'));
try {
  const {blob} = await encryptLines(linesOf(backup), pass);
  const file = path.join(dir, 'savage-backup.savage');
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  const opened = await openBackupFile(file, pass);
  assert.deepEqual(opened, {createdAt: '2026-11-07T15:00:00.000Z', version: 3, academy: true,
    rows: {families: 2, openings: 0, orders: 3, attendance: 1, academy_settings: 1, security_events: 2}});
  await assert.rejects(openBackupFile(file, 'wrong passphrase here'), /passphrase is incorrect/);
} finally { rmSync(dir, {recursive: true, force: true}); }

// --- Each section against its table ---
assert.equal(tableFor('families'), 'family_accounts'); assert.equal(tableFor('openings'), 'coach_openings'); assert.equal(tableFor('orders'), 'orders');
const rows = {families: 2, openings: 0, orders: 3, attendance: 1, academy_settings: 1, security_events: 2};
let r = report(compareCounts(rows, {family_accounts: 2, coach_openings: 0, orders: 3, attendance: 1, academy_settings: 2, security_events: 9}));
assert.equal(r.ok, true, 'everything came back');
const line = t => r.lines.find(l => l.startsWith(t + ' '));
assert.match(line('orders'), /\s3\s+3\s+match$/);
assert.match(line('academy_settings'), /more here$/, 'rows the local site made itself are not a failure');
assert.match(line('security_events'), /not restored  \(Security activity is in the file but never restored/);
r = report(compareCounts(rows, {family_accounts: 1, coach_openings: 0, orders: 3, attendance: 1, academy_settings: 1}));
assert.equal(r.ok, false); assert.deepEqual(r.missing, ['family_accounts']); assert.match(line('family_accounts'), /\s2\s+1\s+MISSING$/);
// A section for a table this site doesn't have: missing if it has rows, skipped if empty.
assert.deepEqual(compareCounts({newer_table: 4, empty_table: 0}, {}).map(x => x.status), ['skipped', 'missing']);

// --- The count query only names real tables ---
assert.equal(countSql(['orders', 'orders', 'family_accounts']), 'SELECT (SELECT count(*) FROM "orders") AS "orders", (SELECT count(*) FROM "family_accounts") AS "family_accounts"');
assert.equal(countSql(['x"; DROP TABLE orders; --', '_cf_KV']), null, 'odd names are left out');

// --- The drill runs a local copy only, and never takes the passphrase from the command line ---
const script = readFileSync('scripts/restore-drill.mjs', 'utf8');
assert.doesNotMatch(script, /--remote|wrangler deploy|secret put|process\.env\.(BACKUP_)?PASSPHRASE|writeFileSync/, 'nothing remote, no passphrase in the environment, nothing written');
assert.match(script, /PERSIST = '\.wrangler\/restore-drill'/); assert.match(script, /rmSync\(PERSIST/, 'the local copy with real records is deleted afterwards');
for (const v of ['EMAIL_API_KEY', 'MAIL_FROM', 'CHECKOUT_KINDS', 'STRIPE_TEST_WEBHOOK_SECRET', 'STRIPE_LIVE_WEBHOOK_SECRET', 'STRIPE_CONFIG_ENCRYPTION_KEY'])
  assert.match(script, new RegExp(`${v}: ''`), v + ' is set empty so the local copy cannot email families or charge cards');
assert.match(script, /USAW_LOOKUP_BASE: 'http:\/\/127\.0\.0\.1:9'/, 'card numbers never go to USA Wrestling');
assert.match(script, /ask\('   Its passphrase \(not shown as you type\): ', true\)/);
assert.match(readFileSync('package.json', 'utf8'), /"restore:drill": "node scripts\/restore-drill\.mjs"/);
const doc = readFileSync('docs/RESTORE_DRILL.md', 'utf8');
assert.match(doc, /pnpm restore:drill/); assert.doesNotMatch(doc, /--remote|wrangler deploy/);
console.log('Restore drill tests passed');
