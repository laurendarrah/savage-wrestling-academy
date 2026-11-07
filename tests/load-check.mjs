// Load check (issue #46). Seeds a local D1 stand-in (tests/fixtures/d1.mjs, which enforces D1's per-statement limits)
// with an academy about three times the size the old caps allowed: 3,000 families, 4,500 wrestlers with USA Wrestling
// cards, a waiver signed for most of them, 6,000 payments and family conversations. Then it checks that the main owner
// pages and the daily job finish and return every row, and that the Backups page's encrypted download restores whole
// (issue #221), and prints how long each took. Nothing here touches a real database. Run it alone with:
// node tests/load-check.mjs, or at another size with LOAD_FAMILIES=10000 node tests/load-check.mjs
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {makeDb, loader, call, D1_LIMITS} from './fixtures/d1.mjs';
import {encryptLines, openBackup, readLines, restoreLines} from '../public/security-backup.js';

const FAMILIES = Number(process.env.LOAD_FAMILIES) || 3000;
const fmt = v => v.toLocaleString('en-US'), WRESTLERS = FAMILIES * 1.5;
const {sqlite, DB, stats} = makeDb();
const env = {DB};
const actor = {owner: true, id: 'owner-id'};
const load = loader(env, actor);
const timings = [];
async function timed(label, fn, counter = stats) {
  counter.queries = 0;
  const start = performance.now(), out = await fn(), ms = performance.now() - start;
  timings.push({label, ms: Math.round(ms), queries: counter.queries});
  return out;
}

// --- Seed ---
const seedStart = performance.now();
const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0), pad = i => String(i).padStart(4, '0');
// A drawn signature like a real one: three strokes of 80 points each, a little different for every wrestler (identical
// drawings would make backups look far more compressible than they are).
const record = n => {
  let seed = n + 1; const jitter = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const strokes = Array.from({length: 3}, (_, s) => Array.from({length: 80}, (_, p) => [+(p / 80 + jitter() / 50).toFixed(4), +((s + 1) / 4 + Math.sin(p + n) / 10 + jitter() / 40).toFixed(4)]));
  return JSON.stringify({version: 1, method: 'drawn', strokes, waiverId: 'wv', waiverSha256: 'a'.repeat(64), signedAt: '2026-09-01T12:00:00Z', signer: 'Parent', accountEmail: 'parent@example.test', consent: 'I consent'});
};
sqlite.exec('BEGIN');
// Settings a backup accepts (lib/academy-validation.ts), so the backup round trip below carries them too.
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2, kids: [], bookings: [], messages: [], offers: [], staff: [], attendance: {}, settings: {}, seasons: [], events: [],
  programs: [{id: 'Elementary', name: 'SWA Development', description: 'Grades K to 6.', priceCents: 20000, walkInPriceCents: 4000}, {id: 'Intermediate', name: 'SWA Intermediate', description: 'Grades 7 to 12.', priceCents: 20000, walkInPriceCents: 4000},
    {id: 'Advanced', name: 'SWA Advance', description: 'Grades 7 to 12, with coach approval.', priceCents: 20000, walkInPriceCents: 4000}]}));
sqlite.prepare("INSERT INTO waiver_versions VALUES ('wv','Participation waiver and release','The approved waiver text.','h',?,'o',NULL,'waiver')").run('2026-09-01T00:00:00Z');
const family = sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)');
const signature = sqlite.prepare('INSERT INTO waiver_signatures VALUES (?,?,?,?,?,?,?,?,?,0)');
const review = sqlite.prepare("INSERT INTO usaw_reviews VALUES (?,?,?,?,'valid','','owner',?)");
const order = sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,'usd',?,'{}',?,?,0,?,?,?,?,?,?)`);
const message = sqlite.prepare("INSERT INTO family_messages(id,user_id,sender_role,body,created_at,read_at,email_status,email_error) VALUES (?,?,?,?,?,NULL,'skipped',NULL)");
const event = sqlite.prepare('INSERT INTO security_events VALUES (?,?,?,?,?)');
let wrestlers = 0, signatures = 0;
for (let i = 0; i < FAMILIES; i++) {
  const u = 'user-' + pad(i), email = `parent${pad(i)}@example.test`, kids = [];
  for (let k = 0; k < (i % 2 ? 2 : 1); k++) {
    const n = wrestlers++, card = n % 10 < 7, expires = n % 10 === 0 ? ny(-3) : n % 10 === 1 ? ny(12) : '2027-08-31';
    kids.push({id: `w${n}`, name: `Wrestler ${pad(n)}`, grade: k ? 'K' : String(1 + (n % 12)), birthDate: '2014-05-0' + (1 + (n % 9)), allergies: n % 7 ? 'None' : 'Peanut allergy. EpiPen in the bag.',
      ...(card ? {usawNumber: String(100000000 + n), usawExpires: expires} : {})});
    if (card && n % 5 === 0) review.run(u, `w${n}`, String(100000000 + n), expires, '2026-09-10T00:00:00Z');
    if (n % 10 < 8) { signature.run(`sig${n}`, 'wv', u, `w${n}`, `Wrestler ${pad(n)}`, 'Parent ' + pad(i), email, record(n), '2026-09-02T00:00:00Z'); signatures++; }
  }
  family.run(u, email, JSON.stringify({parentName: 'Parent ' + pad(i), phone: '(631) 555-' + pad(i), homeAddress: `${i} Railroad St`, homeCity: 'Huntington Station', homeState: 'NY', homeZip: '11746',
    emergencyContactName: 'Contact ' + pad(i), emergencyContactPhone: '(631) 555-0199', wrestlers: kids}), 1, new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString());
  // Two payments per family: a membership for the first wrestler and a walk-in or event, a few refunded or offline.
  const paidAt = d => new Date(Date.UTC(2026, 8, 1) + ((i * 7 + d) % 60) * 86400000).toISOString();
  order.run(`m${pad(i)}`, u, email, kids[0].id, kids[0].name, 'annual', i % 3 ? 'Intermediate' : 'Elementary', 'Intermediate', 'Membership, paid in full', '[]', 240000, 240000, '{}', 'paid', `km${i}`, 't', 't', paidAt(0), ny(-30), ny(330), i % 4 ? 'stripe' : 'offline');
  order.run(`x${pad(i)}`, u, email, kids.at(-1).id, kids.at(-1).name, i % 2 ? 'walkin' : 'event', 'Intermediate', 'item', 'Walk-in practice', '[]', 4000, 4000, '{"method":"cash"}', i % 25 ? 'paid' : 'refunded', `kx${i}`, 't', 't', paidAt(3), null, null, i % 2 ? 'offline' : 'stripe');
  if (i % 3 === 0) for (let m = 0; m < 3; m++) message.run(`msg${i}-${m}`, u, m % 2 ? 'owner' : 'family', 'About practice times', new Date(Date.UTC(2026, 9, 15) + i * 1000 + m).toISOString());
}
for (let e = 0; e < 5000; e++) event.run('ev' + e, 'owner-id', e % 2 ? 'offline_payment_recorded' : 'backup_exported', 'm' + pad(e % FAMILIES), new Date(Date.UTC(2026, 9, 1) + e * 1000).toISOString());
sqlite.exec('COMMIT');
const seedMs = Math.round(performance.now() - seedStart);
const orders = sqlite.prepare('SELECT count(*) AS n FROM orders').get().n;
assert.equal(wrestlers, WRESTLERS); assert.equal(orders, FAMILIES * 2);

// --- Family accounts: every family across all pages ---
const accounts = load('app/accounts/route.ts');
const accountPage = async q => (await call(accounts, '/accounts' + q)).body;
const firstAccounts = await timed('Family accounts, first page', () => accountPage(''));
assert.match(firstAccounts, new RegExp(`<p id="count"[^>]*>${fmt(FAMILIES)} families · ${fmt(WRESTLERS)} wrestlers<`));
const seenFamilies = await timed(`Family accounts, all ${FAMILIES / 50} pages`, async () => {
  const seen = [];
  let html = firstAccounts;
  for (;;) {
    seen.push(...[...html.matchAll(/<p>(parent\d+@example\.test)/g)].map(m => m[1]));
    const next = html.match(/<a class="button" href="([^"]+)" rel="next">/)?.[1]?.replace(/&amp;/g, '&');
    if (!next) break;
    html = await accountPage(next);
  }
  return seen;
});
assert.equal(seenFamilies.length, FAMILIES); assert.equal(new Set(seenFamilies).size, FAMILIES, 'every family once');
const searched = await timed('Family accounts, search', () => accountPage('?q=wrestler%200042'));
assert.match(searched, /parent0028@example\.test/); assert.match(searched, new RegExp(`1 of ${fmt(FAMILIES)} families match`));
const filtered = await timed('Family accounts, program filter', () => accountPage('?program=Elementary'));
assert.match(filtered, new RegExp(`${fmt(Math.ceil(FAMILIES / 3))} of ${fmt(FAMILIES)} families match`));

// --- Cards and waivers: every wrestler counted, pages of 50 ---
const cardsApi = load('app/api/usaw-cards/route.ts');
const cards = await timed('Cards, first page', async () => (await call(cardsApi, '/api/usaw-cards?show=problems')).body);
assert.equal(cards.totals.all, WRESTLERS); assert.equal(cards.cards.length, 50); assert.ok(cards.matched > 1000, 'every blocked card is reachable: ' + cards.matched);
const allCards = await timed('Cards, every page of "Every wrestler"', async () => {
  const seen = new Set();
  let r = (await call(cardsApi, '/api/usaw-cards?show=all')).body;
  r.cards.forEach(c => seen.add(c.wrestlerId));
  while (r.next) { r = (await call(cardsApi, '/api/usaw-cards?show=all&cursor=' + r.next)).body; r.cards.forEach(c => seen.add(c.wrestlerId)); }
  return seen;
});
assert.equal(allCards.size, WRESTLERS);
const waiversApi = load('app/api/waivers/route.ts');
const waivers = await timed('Waivers, first page', async () => (await call(waiversApi, '/api/waivers?show=missing')).body);
assert.deepEqual({...waivers.totals}, {all: WRESTLERS, signed: signatures, missing: WRESTLERS - signatures}); assert.equal(waivers.matched, WRESTLERS - signatures);
// The Parent Consent Form (#218), published and signed for a third of the wrestlers, and the coach contract list.
sqlite.prepare("INSERT INTO waiver_versions VALUES ('pc','Parent Consent Form','The approved form.','h2',?,'o',NULL,'parent_consent')").run('2026-09-05T00:00:00Z');
sqlite.exec("INSERT INTO waiver_signatures SELECT 'pcs'||id,'pc',user_id,wrestler_id,wrestler_name,signer,email,signature_record,signed_at,0 FROM waiver_signatures WHERE version_id='wv' AND CAST(substr(wrestler_id,2) AS INTEGER)%3=0");
const consentSigned = sqlite.prepare("SELECT count(*) AS n FROM waiver_signatures WHERE version_id='pc'").get().n;
const consent = await timed('Parent Consent Form, first page', async () => (await call(waiversApi, '/api/waivers?kind=parent_consent&show=missing')).body);
assert.deepEqual({...consent.totals}, {all: WRESTLERS, signed: consentSigned, missing: WRESTLERS - consentSigned}); assert.equal(consent.wrestlers.length, 50);
const contracts = await timed('Coach contracts, first page', async () => (await call(waiversApi, '/api/waivers?kind=coach_contract')).body);
assert.ok(Array.isArray(contracts.coaches));

// --- Payments: totals over all of them (6,000 at 3,000 families), the spreadsheet has every row ---
const payApi = load('app/api/payments/route.ts');
const payments = await timed('Payments, first page and totals', async () => (await call(payApi, '/api/payments')).body);
assert.equal(payments.matched, FAMILIES * 2); assert.equal(payments.payments.length, 100);
assert.equal(payments.totals.count, sqlite.prepare("SELECT count(*) AS n FROM orders WHERE status='paid'").get().n);
const csv = await timed('Payments spreadsheet (CSV)', async () => (await call(payApi, '/api/payments?format=csv')).body);
assert.equal(csv.trim().split('\r\n').length, FAMILIES * 2 + 1, 'header and every payment');
const picker = await timed('Payments family picker search', async () => (await call(payApi, '/api/payments?families=1&q=parent%202999')).body);
assert.equal(picker.families.length, 1);

// --- Messages and security activity ---
const msgApi = load('app/api/messages/route.ts');
const messages = await timed('Messages, first page', async () => (await call(msgApi, '/api/messages')).body);
assert.equal(messages.familiesMatched, FAMILIES); assert.equal(messages.families[0].userId, 'user-' + pad(FAMILIES - 1 - ((FAMILIES - 1) % 3)), 'latest conversation first');
const security = load('app/security-log/route.ts');
const log = await timed('Security activity, first page', async () => (await call(security, '/security-log')).body);
assert.equal((log.match(/<article>/g) || []).length, 100); assert.match(log, /rel="next">Older activity/);

// --- The daily job: every family in batches, inside D1's per-run query limit ---
const notify = load('lib/notify.ts');
const sent = await timed('Daily reminders (cards, waiver and consent form), all families', () => notify.dailyReminders(false, today));
const reminderQueries = timings.at(-1).queries;
const expected = sqlite.prepare(`SELECT
  (SELECT count(*) FROM family_accounts f, json_each(f.payload,'$.wrestlers') w WHERE json_extract(w.value,'$.usawNumber') IS NOT NULL AND json_extract(w.value,'$.usawExpires')<=?) +
  (SELECT count(*) FROM family_accounts f, json_each(f.payload,'$.wrestlers') w, (SELECT 'wv' AS v UNION SELECT 'pc') d
     WHERE NOT EXISTS (SELECT 1 FROM waiver_signatures s WHERE s.version_id=d.v AND s.user_id=f.user_id AND s.wrestler_id=json_extract(w.value,'$.id'))) AS n`)
  .get(new Date(Date.parse(today + 'T12:00:00Z') + 30 * 86400000).toISOString().slice(0, 10)).n;
assert.equal(sent, expected, 'a notice for every card due and every unsigned waiver and consent form');
assert.equal(sqlite.prepare("SELECT count(*) AS n FROM notifications WHERE kind='consent_needed'").get().n, WRESTLERS - consentSigned);
assert.ok(reminderQueries < D1_LIMITS.queriesPerRun, `daily reminders used ${reminderQueries} queries`);
assert.equal(await notify.dailyReminders(true, today), 0, 'never twice');

// --- An announcement to every family ---
const announced = await timed('Announcement to all families', async () => (await call(msgApi, '/api/messages', {method: 'POST', body: {action: 'announce', audience: {type: 'all'}, subject: 'Snow day', body: 'No practice today.'}})).body);
assert.equal(announced.recipients, FAMILIES); assert.equal(sqlite.prepare('SELECT count(*) AS n FROM announcement_recipients').get().n, FAMILIES);

// --- Backups: every row or a clear refusal, never a partial file; restore at this size ---
const backups = load('lib/backup-records.ts');
const core = await timed('Backup: core records (families, openings)', () => backups.readCore());
assert.equal(core.families.length, FAMILIES, 'the 2,000-family wall is gone');
// The single-object export (GET /api/backups without a mode, used by the checks) holds the whole file in the Worker's
// memory, so past 12 MB it refuses clearly instead of sending part of it.
const full = await timed('Backup: single-object export', async () => { try { return await backups.readBackup(); } catch (e) { return e; } });
let backupNote;
if (!full.records) {   // an error from the module (another realm, so not instanceof Error here)
  assert.ok(full instanceof backups.BackupTooLarge, 'only a clear "too large" refusal: ' + full.message);
  assert.match(full.message, /more than the 12 MB one download can hold/);
  backupNote = 'refused clearly: ' + full.what;
} else {
  for (const [t, rows] of Object.entries(full.records)) assert.equal(rows.length, sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get().n, t);
  backupNote = (JSON.stringify(full).length / 1e6).toFixed(1) + ' MB, every row';
}

// The Backups page (issue #221), end to end through the real route and the page's module (public/security-backup.js):
// the route streams the backup as lines, the module compresses and encrypts them into one file, then unlocks that file
// and restores it into another database in parts, applied in one batch.
const PASS = 'load check passphrase, not a real one';
const tables = ['family_accounts', 'coach_openings', ...Object.keys(backups.RECORD_TABLES)];
const section = t => t === 'family_accounts' ? 'families' : t === 'coach_openings' ? 'openings' : t;
const countIn = (db, t) => db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;
const sourceCounts = Object.fromEntries(tables.map(t => [t, countIn(sqlite, t)]));
const eventsBefore = countIn(sqlite, 'security_events');   // the download itself is logged after its archive is read
const backupRoute = load('app/api/backups/route.ts');
let lineChars = 0, largestLine = 0;
async function* measured(lines) { for await (const line of lines) { const c = JSON.stringify(line).length + 1; lineChars += c; largestLine = Math.max(largestLine, c); yield line; } }
const file = await timed('Backup download: lines streamed, compressed and encrypted', async () => {
  const res = await backupRoute.GET(new Request('https://swa.test/api/backups?mode=lines'));
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /ndjson/);
  return encryptLines(measured(readLines(res.body)), PASS);
});
const exportQueries = timings.at(-1).queries;
assert.ok(exportQueries < D1_LIMITS.queriesPerRun, `the download used ${exportQueries} queries`);
for (const t of tables) assert.equal(file.end.rows[section(t)], sourceCounts[t], t + ' complete in the file');
assert.equal(file.end.rows.security_events, Math.min(eventsBefore, 20000));

const into = makeDb(), intoRoute = loader({DB: into.DB})('app/api/backups/route.ts');
into.sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('existing', 'existing@example.test', JSON.stringify({parentName: 'Existing', phone: '', wrestlers: []}), 1, 't');
let largestBatch = 0, requests = 0, largestRequest = 0;
const batch = into.DB.batch.bind(into.DB);
into.DB.batch = async list => { largestBatch = Math.max(largestBatch, list.length); return batch(list); };
const opened = await timed('Backup restore: unlock and check the file', () => openBackup(file.blob, PASS));
assert.deepEqual(opened.rows, file.end.rows);
const fp = (await call(intoRoute, '/api/backups?mode=preview')).body.fingerprint;
const send = async body => {
  const text = JSON.stringify(body); largestRequest = Math.max(largestRequest, text.length); requests++;
  const r = await call(intoRoute, '/api/backups', {method: 'POST', body});
  if (r.status !== 200) throw Error(`${body.action} ${body.sections?.map(s => s.table + ':' + s.rows.length).join(',') ?? ''}: ${r.status} ${r.body.error}`);
  return r.body;
};
const done = await timed('Backup restore: upload in parts, applied in one batch', () => restoreLines(opened, fp, send), into.stats);
for (const t of tables) assert.equal(countIn(into.sqlite, t), sourceCounts[t] + (t === 'family_accounts' ? 1 : 0), t + ' restored whole');
for (const t of Object.keys(backups.RECORD_TABLES)) {
  assert.equal(done.restored[t] ?? 0, sourceCounts[t], t + ' reported');
  const dump = db => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all());
  assert.ok(dump(into.sqlite) === dump(sqlite), t + ' identical after restore');
}
assert.equal(countIn(into.sqlite, 'restore_staging'), 0, 'the uploaded parts are removed');
assert.ok(largestRequest <= backups.STAGE_REQUEST_BYTES, 'every upload fits one request: ' + largestRequest);
assert.ok(largestBatch < D1_LIMITS.queriesPerRun, `the restore batch has ${largestBatch} statements`);
const mb = b => (b / 1e6).toFixed(1) + ' MB';
const backupReport = `Backups page at ${fmt(FAMILIES)} families: ${mb(lineChars)} of records, ${mb(file.compressedBytes)} compressed, an encrypted file of ${mb(file.blob.size)}; `
  + `largest line ${mb(largestLine)}; the download used ${exportQueries} database queries. Restore: ${requests} requests (largest ${mb(largestRequest)}), then one batch of ${largestBatch} statements.`;

// The single-object restore at this size: the writes and the recovery snapshot are split under D1's limits.
const target = makeDb(), targetLoad = loader({DB: target.DB}), targetBackups = targetLoad('lib/backup-records.ts');
target.sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('existing', 'existing@example.test', JSON.stringify({parentName: 'Existing', phone: '', wrestlers: []}), 1, 't');
const restored = await timed(`Backup restore of ${fmt(FAMILIES)} families' core records, twice (empty database, then over it)`, async () => {
  await targetBackups.restoreBackup(JSON.parse(JSON.stringify(core)), await targetBackups.fingerprint(await targetBackups.metadata()), 'owner');
  // A second restore snapshots every family again (about 3 MB at 3,000 families): saved in parts and read back whole.
  return targetBackups.restoreBackup(JSON.parse(JSON.stringify(core)), await targetBackups.fingerprint(await targetBackups.metadata()), 'owner');
}, target.stats);
assert.ok(restored);
assert.equal(target.sqlite.prepare('SELECT count(*) AS n FROM family_accounts').get().n, FAMILIES + 1);
const snaps = target.sqlite.prepare("SELECT id FROM recovery_snapshots WHERE instr(id,':')=0 ORDER BY created_at DESC").all();
assert.ok(target.sqlite.prepare("SELECT count(*) AS n FROM recovery_snapshots WHERE instr(id,':')>0").get().n > 0, 'the large snapshot is saved in parts');
assert.equal((await targetBackups.readSnapshot(snaps[0].id)).families.length, FAMILIES + 1, 'and read back whole');

console.log(`Load check passed. Seeded ${FAMILIES.toLocaleString('en-US')} families, ${wrestlers.toLocaleString('en-US')} wrestlers, ${signatures.toLocaleString('en-US')} signed waivers, ${orders.toLocaleString('en-US')} payments in ${seedMs} ms.`);
console.log(`Daily reminders sent ${sent.toLocaleString('en-US')} notices. Single-object backup (GET /api/backups): ${backupNote}.`);
console.log(backupReport);
console.log(['| Step | Time (ms) | Database queries |', '|---|---:|---:|', ...timings.map(t => `| ${t.label} | ${t.ms} | ${t.queries} |`)].join('\n'));
