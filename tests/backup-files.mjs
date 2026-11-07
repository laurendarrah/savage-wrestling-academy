// Issue #221: backup files of every format restore through the Backups page's code (public/security-backup.js) and the
// real route (app/api/backups/route.ts), and the restore in parts keeps every protection of the one-request restore.
//
// tests/fixtures/backups/v1-file-version-*.savage were saved by the code on main before issue #221 (commit 90c4179):
// readBackup or readCore from lib/backup-records.ts on the records seeded in tests/backup-coverage.mjs, encrypted with
// encryptBackup from public/security-backup.js and saved as JSON, exactly as the old Backups page did. Version 3 is a full
// download, version 2 has the first six tables (before issue #78), version 1 is the core sections (a snapshot download).
// They are synthetic records; the passphrase below opens them.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeDb, loader, call} from './fixtures/d1.mjs';
import {decryptBackup, encryptLines, openBackup, readLines, restoreLines, linesOf, checkedLines} from '../public/security-backup.js';

const PASS = 'fixture passphrase for tests only', NEW_PASS = 'a different passphrase for the new file';
const actor = {owner: true, id: 'owner-id'};
function site(wrap = db => db) {
  const db = makeDb(), load = loader({DB: wrap(db.DB, db.sqlite)}, actor);
  return {...db, route: load('app/api/backups/route.ts'), lib: load('lib/backup-records.ts')};
}
const post = (s, body) => call(s.route, '/api/backups', {method: 'POST', body});
const send = s => async body => { const r = await post(s, body); if (r.status !== 200) throw Object.assign(Error(r.body.error), {status: r.status}); return r.body; };
const fingerprint = async s => (await call(s.route, '/api/backups?mode=preview')).body.fingerprint;
const fixture = name => readFileSync('tests/fixtures/backups/' + name);
const count = (s, t) => s.sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;
const dump = (s, t) => JSON.stringify(s.sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1`).all());
const fails = async (promise, pattern, message) => { await assert.rejects(promise, e => pattern.test(e.message), message); };
let tables;

// ---------- 1. Files saved by the old Backups page still open and restore ----------
for (const [name, version] of [['v1-file-version-3.savage', 3], ['v1-file-version-2.savage', 2], ['v1-file-version-1.savage', 1]]) {
  const old = await decryptBackup(JSON.parse(fixture(name)), PASS);
  assert.equal(old.version, version);
  const opened = await openBackup(new Blob([fixture(name)]), PASS);
  assert.equal(opened.header.version, version); assert.equal(opened.header.createdAt, old.createdAt);
  assert.equal(opened.rows.families, old.families.length); assert.equal(opened.rows.openings, old.openings.length);
  for (const [t, rows] of Object.entries(old.records ?? {})) assert.equal(opened.rows[t], rows.length, `${name}: ${t} counted`);
  const s = site();
  tables ??= Object.keys(s.lib.RECORD_TABLES);
  const done = await restoreLines(opened, await fingerprint(s), send(s));
  assert.equal(count(s, 'family_accounts'), old.families.length, name + ' families');
  assert.equal(count(s, 'coach_openings'), old.openings.length, name + ' openings');
  for (const t of tables) {
    const expected = old.records?.[t]?.length ?? 0;
    assert.equal(count(s, t), expected, `${name}: ${t} restored`);
    assert.equal(done.restored[t] ?? 0, expected, `${name}: ${t} reported`);
  }
  assert.equal(count(s, 'restore_staging'), 0, 'parts removed after the restore');
  const event = s.sqlite.prepare("SELECT target FROM security_events WHERE action='backup_restored'").get();
  assert.match(event.target, version === 1 ? /^v1$/ : new RegExp(`^v${version}:`));
  // The same file through the one-request restore gives the same database.
  const t = site();
  assert.equal((await post(t, {action: 'restore', fingerprint: await fingerprint(t), backup: old})).status, 200);
  for (const table of ['family_accounts', 'coach_openings', ...tables]) assert.equal(count(t, table), count(s, table), `${name}: ${table} same either way`);
}
// A wrong passphrase or a damaged old file is refused.
await fails(openBackup(new Blob([fixture('v1-file-version-3.savage')]), 'not the right passphrase'), /passphrase is incorrect or the backup file is damaged/);
{ const env = JSON.parse(fixture('v1-file-version-3.savage')); env.data = (env.data[0] === 'A' ? 'B' : 'A') + env.data.slice(1);
  await fails(openBackup(new Blob([JSON.stringify(env)]), PASS), /passphrase is incorrect or the backup file is damaged/); }
await fails(openBackup(new Blob(['not a backup']), PASS), /format is not supported/);

// ---------- 2. A new file: streamed, compressed, encrypted; restores exactly ----------
const source = site();
{ const opened = await openBackup(new Blob([fixture('v1-file-version-3.savage')]), PASS); await restoreLines(opened, await fingerprint(source), send(source)); }
source.sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({kids: [], bookings: [], messages: [], offers: [], seasons: [], staff: [], attendance: {}, settings: {note: 'kept'}}));
source.sqlite.prepare("INSERT INTO coach_openings(id,user_id,date,start,end,coach_email,format,capacity,closed,invite_code,organizer_id,organizer_wrestlers) VALUES ('open-2','coach-1','2026-12-02','16:00','17:00','dana@example.test','small-group',4,0,?,NULL,NULL)").run('i'.repeat(32));
// Issue #239: a signature the owner asked to be signed again (the old file predates the table).
source.sqlite.prepare("INSERT INTO signature_reissues(signature_id,user_id,reason,reissued_by,reissued_at) VALUES ('ws-1','parent-1','Signed for the wrong wrestler','owner','2026-11-07T12:00:00.000Z')").run();
// Issue #248: a walk-in booked to pay cash at the academy (the old file predates the table).
source.sqlite.prepare(`INSERT INTO cash_bookings(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,session_date,start_time,end_time,base_cents,discount_cents,amount_cents,pricing,dedupe_key,status,order_id,created_at,updated_at,canceled_at,canceled_by,cancel_reason)
  VALUES ('cash-1','parent-1','pat@example.test','w-1','Sam Example','live',NULL,'fnl','Friday Night Live on Fri, Nov 20','2026-11-20','17:00','18:00',2000,1000,1000,'{"member":true}','parent-1|w-1|live|fnl|2026-11-20','due',NULL,'2026-11-07T12:00:00.000Z','2026-11-07T12:00:00.000Z',NULL,NULL,NULL)`).run();
const exported = await source.route.GET(new Request('https://swa.test/api/backups?mode=lines'));
assert.equal(exported.status, 200); assert.match(exported.headers.get('content-type'), /application\/x-ndjson/); assert.equal(exported.headers.get('cache-control'), 'private, no-store');
const made = await encryptLines(readLines(exported.body), NEW_PASS);
assert.equal(source.sqlite.prepare("SELECT count(*) AS n FROM security_events WHERE action='backup_exported'").get().n, 1, 'the download is logged');
const bytes = new Uint8Array(await made.blob.arrayBuffer()), newline = bytes.indexOf(10), head = JSON.parse(new TextDecoder().decode(bytes.subarray(0, newline)));
assert.deepEqual(Object.keys(head), ['format', 'project', 'cipher', 'kdf', 'iterations', 'salt', 'iv', 'compression']);
assert.equal(head.format, 'savage-encrypted-backup-v2'); assert.equal(head.iterations, 600000); assert.equal(head.compression, 'gzip');
assert.ok(!new TextDecoder().decode(bytes).includes('Pat Parent') && !new TextDecoder().decode(bytes).includes('pat@example.test'), 'nothing readable in the file');
const opened = await openBackup(made.blob, NEW_PASS);
assert.equal(opened.header.version, 3); assert.deepEqual(opened.header.academy.settings, {note: 'kept'});
assert.equal(opened.rows.openings, 2); assert.equal(opened.rows.security_events, count(source, 'security_events') - 1);
const target = site();
const done = await restoreLines(opened, await fingerprint(target), send(target));
for (const t of tables) { assert.equal(dump(target, t), dump(source, t), t + ' identical after restore'); assert.equal(done.restored[t], count(source, t), t + ' reported'); }
assert.deepEqual(JSON.parse(target.sqlite.prepare('SELECT payload FROM academy_state').get().payload), JSON.parse(source.sqlite.prepare('SELECT payload FROM academy_state').get().payload));
{ const cols = 'id,user_id,date,start,end,coach_email,format,capacity,closed,invite_code,organizer_id,organizer_wrestlers', q = s => JSON.stringify(s.sqlite.prepare(`SELECT ${cols} FROM coach_openings ORDER BY id`).all());
  assert.equal(q(target), q(source), 'openings with and without group fields restored'); }
assert.equal(target.sqlite.prepare('SELECT payload FROM family_accounts').get().payload, source.sqlite.prepare('SELECT payload FROM family_accounts').get().payload);
assert.equal(count(target, 'security_events'), 1, 'audit history is never restored, only the restore is logged');
assert.equal(count(target, 'restore_staging'), 0);
assert.equal(JSON.parse(target.sqlite.prepare('SELECT payload FROM recovery_snapshots').get().payload).version, 1, 'a recovery snapshot is saved first');
// Restoring the same file again re-creates nothing and changes no existing record.
target.sqlite.prepare("UPDATE orders SET status='refunded'").run();
const again = await restoreLines(await openBackup(made.blob, NEW_PASS), await fingerprint(target), send(target));
for (const t of tables) assert.equal(again.restored[t] ?? 0, 0, t + ' nothing re-added');
assert.equal(target.sqlite.prepare('SELECT status FROM orders').get().status, 'refunded', 'an existing payment is not overwritten');

// ---------- 3. The new file's encryption ----------
await fails(openBackup(made.blob, 'not the right passphrase'), /passphrase is incorrect or the backup file is damaged/);
const reheaded = text => new Blob([text + '\n', bytes.subarray(newline + 1)]);
assert.equal((await openBackup(reheaded(new TextDecoder().decode(bytes.subarray(0, newline))), NEW_PASS)).header.version, 3, 'the same first line opens');
// The first line is authenticated: any change to it, even one with the same meaning that the format check accepts, is refused.
await fails(openBackup(reheaded(JSON.stringify(head).replace('"gzip"', ' "gzip"')), NEW_PASS), /passphrase is incorrect or the backup file is damaged/);
await fails(openBackup(reheaded(JSON.stringify({...head, iterations: 100000})), NEW_PASS), /format is not supported/);
await fails(openBackup(reheaded(JSON.stringify({...head, compression: 'none'})), NEW_PASS), /format is not supported/);
{ const saltAt = new TextDecoder().decode(bytes.subarray(0, newline)).indexOf(head.salt), copy = bytes.slice(); copy[saltAt] = copy[saltAt] === 65 ? 66 : 65;
  await fails(openBackup(new Blob([copy]), NEW_PASS), /passphrase is incorrect or the backup file is damaged/, 'salt changed'); }
{ const copy = bytes.slice(); copy[copy.length - 20] ^= 1; await fails(openBackup(new Blob([copy]), NEW_PASS), /passphrase is incorrect or the backup file is damaged/, 'data changed'); }
await fails(openBackup(new Blob([bytes.subarray(0, bytes.length - 100)]), NEW_PASS), /passphrase is incorrect or the backup file is damaged/, 'file cut short');
// Two files of the same records never share a salt or IV.
{ const other = await encryptLines(linesOf(await decryptBackup(JSON.parse(fixture('v1-file-version-1.savage')), PASS)), NEW_PASS), h2 = JSON.parse((await other.blob.text()).split('\n')[0]);
  assert.notEqual(h2.salt, head.salt); assert.notEqual(h2.iv, head.iv);
  // A snapshot download (core sections only) is written the same way and restores as version 1.
  const s = site(); const r = await restoreLines(await openBackup(other.blob, NEW_PASS), await fingerprint(s), send(s));
  assert.deepEqual(r.restored, {}); assert.equal(count(s, 'family_accounts'), 1); }
await assert.rejects(encryptLines([{version: 3, project: 'x', academy: null}], NEW_PASS), /not a supported backup/);

// ---------- 4. A download that does not finish never becomes a file ----------
const lines = async function* (list) { for (const l of list) yield l; };
const header = {version: 3, project: 'appgprj_6ad13665e8c881918c12b096132b4cae', createdAt: 'x', academy: null};
await fails(encryptLines(lines([header, {table: 'families', rows: []}]), NEW_PASS), /download did not finish. No file was saved/);
await fails(encryptLines(lines([header, {table: 'orders', rows: [{}]}, {end: true, rows: {orders: 2}, truncated: false}]), NEW_PASS), /incomplete or damaged/, 'counts must match');
await fails(encryptLines(lines([header, {error: 'The academy\'s records are too large for one backup download.'}]), NEW_PASS), /too large for one backup download/);
await fails(encryptLines(lines([header, {end: true, rows: {}, truncated: false}, {table: 'orders', rows: []}]), NEW_PASS), /incomplete or damaged/, 'nothing after the end');
// The route sends an error line, not an end line, when the export fails part way.
{ const broken = site((db, sqlite) => ({...db, prepare: sql => { if (/FROM orders/.test(sql)) throw Error('database unavailable'); return db.prepare(sql); }, batch: db.batch}));
  broken.sqlite.prepare("INSERT INTO family_accounts VALUES ('u1','a@example.test',?,1,'t')").run(JSON.stringify({parentName: 'A', phone: '', wrestlers: []}));
  const res = await broken.route.GET(new Request('https://swa.test/api/backups?mode=lines'));
  const text = await res.text(), last = JSON.parse(text.trim().split('\n').at(-1));
  assert.equal(last.error, 'Backup export could not finish. No records were changed.'); assert.ok(!/"end":true/.test(text));
  assert.equal(broken.sqlite.prepare("SELECT count(*) AS n FROM security_events WHERE action='backup_exported'").get().n, 0, 'an unfinished download is not logged');
  await fails(encryptLines(readLines(new Response(text).body), NEW_PASS), /could not finish/); }
// A table past the row limit stops the export with a clear message instead of a partial file.
await assert.rejects((async () => { for await (const _ of source.lib.backupLines(0)); })(), e => e instanceof source.lib.BackupTooLarge && /more than 0 rows in practice_curriculum_groups/.test(e.message));
// A family that is not the owner cannot download or restore.
actor.owner = false;
assert.equal((await source.route.GET(new Request('https://swa.test/api/backups?mode=lines'))).status, 403);
assert.equal((await post(source, {action: 'begin'})).status, 403);
actor.owner = true;

// ---------- 5. The restore in parts keeps every protection ----------
const file = await decryptBackup(JSON.parse(fixture('v1-file-version-3.savage')), PASS);
const v3 = {header: {version: 3, project: file.project, createdAt: file.createdAt, academy: file.academy}, truncated: false,
  rows: {families: file.families.length, openings: file.openings.length, ...Object.fromEntries(Object.entries(file.records).map(([t, r]) => [t, r.length])), security_events: file.archive.security_events.length}};
const allSections = [['families', file.families], ['openings', file.openings], ...Object.entries(file.records), ['security_events', file.archive.security_events]].map(([table, rows]) => ({table, rows}));
async function staged(s, sections = allSections) { const {upload} = (await post(s, {action: 'begin'})).body; for (const part of sections) assert.equal((await post(s, {action: 'stage', upload, sections: [part]})).status, 200, part.table); return upload; }
const commit = async (s, upload, extra = {}) => post(s, {action: 'commit', upload, fingerprint: await fingerprint(s), ...v3, ...extra});
{ // A bad row is refused when it arrives and the upload is discarded.
  const s = site(), {upload} = (await post(s, {action: 'begin'})).body;
  const bad = {...file.records.orders[0], amount_cents: '240000'};
  const r = await post(s, {action: 'stage', upload, sections: [{table: 'orders', rows: [bad]}]});
  assert.equal(r.status, 400); assert.match(r.body.error, /not a supported backup/); assert.equal(count(s, 'restore_staging'), 0);
  assert.equal((await post(s, {action: 'stage', upload, sections: [{table: 'staff_access', rows: []}]})).status, 400, 'no section for access grants');
}
{ // A section that did not arrive whole, or a count that does not match, is refused; nothing is written.
  const s = site(), upload = await staged(s, allSections.filter(p => p.table !== 'orders'));
  const r = await commit(s, upload); assert.equal(r.status, 400); assert.equal(count(s, 'restore_staging'), 0); assert.equal(count(s, 'family_accounts'), 0);
  const u2 = await staged(s); assert.equal((await commit(s, u2, {rows: {...v3.rows, orders: 2}})).status, 400, 'count above what arrived');
  const u3 = await staged(s), {orders, ...missing} = v3.rows; assert.equal((await commit(s, u3, {rows: missing})).status, 400, 'a version 3 file cannot drop a table');
  const u4 = await staged(s); assert.equal((await commit(s, u4, {header: {...v3.header, version: 2}})).status, 400, 'a version 2 file cannot carry version 3 tables');
  const u5 = await staged(s); assert.equal((await commit(s, u5, {header: {...v3.header, project: 'another-site'}})).status, 400, 'another site\'s backup');
  const u6 = await staged(s); assert.equal((await commit(s, u6, {truncated: undefined})).status, 400, 'the archive flag is required');
  assert.equal(count(s, 'family_accounts'), 0); assert.equal(count(s, 'restore_staging'), 0);
}
{ // The same key in two parts is refused at the commit.
  const s = site(), upload = await staged(s);
  assert.equal((await post(s, {action: 'stage', upload, sections: [{table: 'orders', rows: file.records.orders}]})).status, 200, 'each part alone is fine');
  const r = await commit(s, upload, {rows: {...v3.rows, orders: 2}}); assert.equal(r.status, 400); assert.equal(count(s, 'orders'), 0);
  const u2 = await staged(s); await post(s, {action: 'stage', upload: u2, sections: [{table: 'families', rows: file.families}]});
  assert.equal((await commit(s, u2, {rows: {...v3.rows, families: 2}})).status, 400, 'a family twice');
}
{ // Records changed after preview: refused, nothing written, the upload discarded.
  const s = site(), upload = await staged(s), before = await fingerprint(s);
  s.sqlite.prepare("INSERT INTO family_accounts VALUES ('new-family','n@example.test','{}',1,'t')").run();
  const r = await post(s, {action: 'commit', upload, fingerprint: before, ...v3});
  assert.equal(r.status, 409); assert.match(r.body.error, /Records changed after preview/); assert.equal(count(s, 'orders'), 0); assert.equal(count(s, 'restore_staging'), 0);
}
{ // Records changed while the batch runs: the guard fails, the whole batch rolls back, nothing is half applied.
  let race = false;
  const s = site((db, sqlite) => ({prepare: sql => db.prepare(sql), batch: list => { if (race) sqlite.exec("UPDATE family_accounts SET revision=revision+1"); return db.batch(list); }}));
  s.sqlite.prepare("INSERT INTO family_accounts VALUES ('parent-1','pat@example.test',?,1,'t')").run(JSON.stringify({parentName: 'Changed', phone: '', wrestlers: []}));
  const upload = await staged(s); race = true; const r = await commit(s, upload); race = false;
  assert.equal(r.status, 409); assert.match(r.body.error, /No partial restore was applied/);
  assert.equal(count(s, 'orders'), 0); assert.equal(count(s, 'recovery_snapshots'), 0); assert.equal(count(s, 'restore_staging'), 0);
  assert.equal(JSON.parse(s.sqlite.prepare('SELECT payload FROM family_accounts').get().payload).parentName, 'Changed');
}
{ // An upload belongs to the owner session that began it, ends when another begins, and expires after a day.
  const s = site(), upload = await staged(s);
  actor.id = 'someone-else';
  assert.equal((await post(s, {action: 'stage', upload, sections: [allSections[0]]})).status, 409);
  assert.equal((await commit(s, upload)).status, 409);
  actor.id = 'owner-id';
  const u1 = await staged(s), u2 = (await post(s, {action: 'begin'})).body.upload;
  assert.equal((await commit(s, u1)).status, 409, 'replaced by a newer restore');
  s.sqlite.prepare("UPDATE restore_staging SET created_at='2020-01-01T00:00:00.000Z' WHERE upload=?").run(u2);
  assert.equal((await post(s, {action: 'stage', upload: u2, sections: [allSections[0]]})).status, 409, 'expired');
  // The daily job removes uploads that were never finished, and keeps one in progress.
  const old = (await post(s, {action: 'begin'})).body.upload;
  actor.id = 'other-owner-session'; const fresh = await staged(s); actor.id = 'owner-id';
  s.sqlite.prepare("UPDATE restore_staging SET created_at='2020-01-01T00:00:00.000Z' WHERE upload=?").run(old);
  s.sqlite.prepare("INSERT INTO restore_staging(id,upload,user_id,seq,section,grouped,row_count,bytes,payload,created_at) VALUES ('orphan:1','orphan','x',1,'orders',0,0,0,'[]',?)").run(new Date().toISOString());
  await s.lib.clearStaleStaging();
  assert.deepEqual(s.sqlite.prepare('SELECT DISTINCT upload FROM restore_staging').all().map(r => r.upload), [fresh]);
  assert.equal((await commit(s, fresh)).status, 409, 'committed only by its own session');
  actor.id = 'other-owner-session'; assert.equal((await commit(s, fresh)).status, 200); actor.id = 'owner-id';
}
{ // A part request over the size limit, and sections that are not backup sections, are refused.
  const s = site(), {upload} = (await post(s, {action: 'begin'})).body;
  const huge = {table: 'family_messages', rows: [{id: 'm', user_id: 'u', sender_role: 'owner', body: 'x'.repeat(9000001), created_at: 't', read_at: null, email_status: 'sent'}]};
  assert.equal((await post(s, {action: 'stage', upload, sections: [huge]})).status, 413);
  assert.equal((await post(s, {action: 'stage', upload: 'not-an-upload', sections: [allSections[0]]})).status, 400);
  assert.equal((await post(s, {action: 'stage', upload, sections: []})).status, 400);
}
// checkedLines passes a well-formed series through unchanged.
{ const seen = []; for await (const l of checkedLines(linesOf(file))) seen.push(l); assert.equal(seen[0].version, 3); assert.equal(seen.at(-1).end, true); assert.deepEqual(seen.at(-1).rows, v3.rows); }

console.log('Passed: files saved by the old Backups page (versions 1, 2 and 3) open and restore through the new restore in parts; new compressed, encrypted files restore exactly; the first line is authenticated; unfinished downloads never become files; the restore in parts refuses bad rows, missing or repeated records, changed records and other sessions\' uploads, and is all or nothing.');
