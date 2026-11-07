// Load check (issue #46). Seeds a local D1 stand-in (tests/fixtures/d1.mjs, which enforces D1's per-statement limits)
// with an academy about three times the size the old caps allowed: 3,000 families, 4,500 wrestlers with USA Wrestling
// cards, a waiver signed for most of them, 6,000 payments and family conversations. Then it checks that the main owner
// pages and the daily job finish and return every row, and prints how long each took. Nothing here touches a real
// database. Run it alone with: node tests/load-check.mjs
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {makeDb, loader, call, D1_LIMITS} from './fixtures/d1.mjs';

const FAMILIES = 3000;
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
// A drawn signature like a real one: three strokes of 80 points each.
const strokes = Array.from({length: 3}, (_, s) => Array.from({length: 80}, (_, p) => [+(p / 80).toFixed(4), +((s + 1) / 4 + Math.sin(p) / 10).toFixed(4)]));
const record = JSON.stringify({version: 1, method: 'drawn', strokes, waiverId: 'wv', waiverSha256: 'a'.repeat(64), signedAt: '2026-09-01T12:00:00Z', signer: 'Parent', accountEmail: 'parent@example.test', consent: 'I consent'});
sqlite.exec('BEGIN');
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2, programs: [{id: 'Elementary', name: 'SWA Development', priceCents: 20000, walkInPriceCents: 4000}, {id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}], seasons: [], events: []}));
sqlite.prepare("INSERT INTO waiver_versions VALUES ('wv','Participation waiver and release','The approved waiver text.','h',?,'o',NULL,'waiver')").run('2026-09-01T00:00:00Z');
const family = sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)');
const signature = sqlite.prepare('INSERT INTO waiver_signatures VALUES (?,?,?,?,?,?,?,?,?)');
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
    if (n % 10 < 8) { signature.run(`sig${n}`, 'wv', u, `w${n}`, `Wrestler ${pad(n)}`, 'Parent ' + pad(i), email, record, '2026-09-02T00:00:00Z'); signatures++; }
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
assert.equal(wrestlers, 4500); assert.equal(orders, 6000);

// --- Family accounts: every family across 60 pages ---
const accounts = load('app/accounts/route.ts');
const accountPage = async q => (await call(accounts, '/accounts' + q)).body;
const firstAccounts = await timed('Family accounts, first page', () => accountPage(''));
assert.match(firstAccounts, /<p id="count"[^>]*>3,000 families · 4,500 wrestlers</);
const seenFamilies = await timed('Family accounts, all 60 pages', async () => {
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
assert.match(searched, /parent0028@example\.test/); assert.match(searched, /1 of 3,000 families match/);
const filtered = await timed('Family accounts, program filter', () => accountPage('?program=Elementary'));
assert.match(filtered, /1,000 of 3,000 families match/);

// --- Cards and waivers: every wrestler counted, pages of 50 ---
const cardsApi = load('app/api/usaw-cards/route.ts');
const cards = await timed('Cards, first page', async () => (await call(cardsApi, '/api/usaw-cards?show=problems')).body);
assert.equal(cards.totals.all, 4500); assert.equal(cards.cards.length, 50); assert.ok(cards.matched > 1000, 'every blocked card is reachable: ' + cards.matched);
const allCards = await timed('Cards, every page of "Every wrestler"', async () => {
  const seen = new Set();
  let r = (await call(cardsApi, '/api/usaw-cards?show=all')).body;
  r.cards.forEach(c => seen.add(c.wrestlerId));
  while (r.next) { r = (await call(cardsApi, '/api/usaw-cards?show=all&cursor=' + r.next)).body; r.cards.forEach(c => seen.add(c.wrestlerId)); }
  return seen;
});
assert.equal(allCards.size, 4500);
const waiversApi = load('app/api/waivers/route.ts');
const waivers = await timed('Waivers, first page', async () => (await call(waiversApi, '/api/waivers?show=missing')).body);
assert.deepEqual({...waivers.totals}, {all: 4500, signed: signatures, missing: 4500 - signatures}); assert.equal(waivers.matched, 4500 - signatures);
// The Parent Consent Form (#218), published and signed for a third of the wrestlers, and the coach contract list.
sqlite.prepare("INSERT INTO waiver_versions VALUES ('pc','Parent Consent Form','The approved form.','h2',?,'o',NULL,'parent_consent')").run('2026-09-05T00:00:00Z');
sqlite.exec("INSERT INTO waiver_signatures SELECT 'pcs'||id,'pc',user_id,wrestler_id,wrestler_name,signer,email,signature_record,signed_at FROM waiver_signatures WHERE version_id='wv' AND CAST(substr(wrestler_id,2) AS INTEGER)%3=0");
const consentSigned = sqlite.prepare("SELECT count(*) AS n FROM waiver_signatures WHERE version_id='pc'").get().n;
const consent = await timed('Parent Consent Form, first page', async () => (await call(waiversApi, '/api/waivers?kind=parent_consent&show=missing')).body);
assert.deepEqual({...consent.totals}, {all: 4500, signed: consentSigned, missing: 4500 - consentSigned}); assert.equal(consent.wrestlers.length, 50);
const contracts = await timed('Coach contracts, first page', async () => (await call(waiversApi, '/api/waivers?kind=coach_contract')).body);
assert.ok(Array.isArray(contracts.coaches));

// --- Payments: totals over all 6,000, the spreadsheet has every row ---
const payApi = load('app/api/payments/route.ts');
const payments = await timed('Payments, first page and totals', async () => (await call(payApi, '/api/payments')).body);
assert.equal(payments.matched, 6000); assert.equal(payments.payments.length, 100);
assert.equal(payments.totals.count, sqlite.prepare("SELECT count(*) AS n FROM orders WHERE status='paid'").get().n);
const csv = await timed('Payments spreadsheet (CSV)', async () => (await call(payApi, '/api/payments?format=csv')).body);
assert.equal(csv.trim().split('\r\n').length, 6001, 'header and every payment');
const picker = await timed('Payments family picker search', async () => (await call(payApi, '/api/payments?families=1&q=parent%202999')).body);
assert.equal(picker.families.length, 1);

// --- Messages and security activity ---
const msgApi = load('app/api/messages/route.ts');
const messages = await timed('Messages, first page', async () => (await call(msgApi, '/api/messages')).body);
assert.equal(messages.familiesMatched, FAMILIES); assert.equal(messages.families[0].userId, 'user-2997', 'latest conversation first');
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
assert.equal(sqlite.prepare("SELECT count(*) AS n FROM notifications WHERE kind='consent_needed'").get().n, 4500 - consentSigned);
assert.ok(reminderQueries < D1_LIMITS.queriesPerRun, `daily reminders used ${reminderQueries} queries`);
assert.equal(await notify.dailyReminders(true, today), 0, 'never twice');

// --- An announcement to all 3,000 families ---
const announced = await timed('Announcement to all families', async () => (await call(msgApi, '/api/messages', {method: 'POST', body: {action: 'announce', audience: {type: 'all'}, subject: 'Snow day', body: 'No practice today.'}})).body);
assert.equal(announced.recipients, FAMILIES); assert.equal(sqlite.prepare('SELECT count(*) AS n FROM announcement_recipients').get().n, FAMILIES);

// --- Backups: every row or a clear refusal, never a partial file; restore at this size ---
const backups = load('lib/backup-records.ts');
const core = await timed('Backup: core records (families, openings)', () => backups.readCore());
assert.equal(core.families.length, FAMILIES, 'the 2,000-family wall is gone');
const full = await timed('Backup: full download', async () => { try { return await backups.readBackup(); } catch (e) { return e; } });
let backupNote;
if (!full.records) {   // an error from the module (another realm, so not instanceof Error here)
  assert.ok(full instanceof backups.BackupTooLarge, 'only a clear "too large" refusal: ' + full.message);
  assert.match(full.message, /MB, more than the 12 MB a file can hold/);
  backupNote = 'refused clearly: ' + full.what;
} else {
  for (const [t, rows] of Object.entries(full.records)) assert.equal(rows.length, sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get().n, t);
  backupNote = (JSON.stringify(full).length / 1e6).toFixed(1) + ' MB, every row';
}
// Restore 3,000 families into an empty database: the writes and the recovery snapshot are split under D1's limits.
const target = makeDb(), targetLoad = loader({DB: target.DB}), targetBackups = targetLoad('lib/backup-records.ts');
target.sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('existing', 'existing@example.test', JSON.stringify({parentName: 'Existing', phone: '', wrestlers: []}), 1, 't');
const restored = await timed('Backup restore of 3,000 families, twice (empty database, then over it)', async () => {
  await targetBackups.restoreBackup(JSON.parse(JSON.stringify(core)), await targetBackups.fingerprint(await targetBackups.metadata()), 'owner');
  // A second restore snapshots 3,001 families (about 3 MB): saved in parts and read back whole.
  return targetBackups.restoreBackup(JSON.parse(JSON.stringify(core)), await targetBackups.fingerprint(await targetBackups.metadata()), 'owner');
}, target.stats);
assert.ok(restored);
assert.equal(target.sqlite.prepare('SELECT count(*) AS n FROM family_accounts').get().n, FAMILIES + 1);
const snaps = target.sqlite.prepare("SELECT id FROM recovery_snapshots WHERE instr(id,':')=0 ORDER BY created_at DESC").all();
assert.ok(target.sqlite.prepare("SELECT count(*) AS n FROM recovery_snapshots WHERE instr(id,':')>0").get().n > 0, 'the large snapshot is saved in parts');
assert.equal((await targetBackups.readSnapshot(snaps[0].id)).families.length, FAMILIES + 1, 'and read back whole');

console.log(`Load check passed. Seeded ${FAMILIES.toLocaleString('en-US')} families, ${wrestlers.toLocaleString('en-US')} wrestlers, ${signatures.toLocaleString('en-US')} signed waivers, ${orders.toLocaleString('en-US')} payments in ${seedMs} ms.`);
console.log(`Daily reminders sent ${sent.toLocaleString('en-US')} notices. Full backup download: ${backupNote}.`);
console.log(['| Step | Time (ms) | Database queries |', '|---|---:|---:|', ...timings.map(t => `| ${t.label} | ${t.ms} | ${t.queries} |`)].join('\n'));
