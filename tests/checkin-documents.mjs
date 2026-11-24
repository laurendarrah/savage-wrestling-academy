// Issue #402 (Justin's decision of Nov 9, confirmed Nov 23 on #246): no wrestler is checked in at a practice, camp,
// clinic, Friday Night Live or event unless every family document in force (the waiver and the Parent Consent Form) is
// signed for them, by hand or by pass. A document counts only while a version is published. No owner exception lets a
// wrestler in at the door, though it still lets them book. The USA Wrestling card rule (tests/checkin-card-block.mjs)
// stays, and the cards page counts only card problems.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; },
  _execute() { const st = sqlite.prepare(sql); return st.columns().length ? {results: st.all(...a)} : {results: [], meta: st.run(...a)}; }}; },
  async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(x => x._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }};

let actor = {kind: 'owner'};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, btoa, Intl, Date, URL, Response, Request, Headers, JSON, Map, Set, Object, Array, String, Number, Math, Uint8Array, TextEncoder, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env: {DB}};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: actor.kind === 'owner' ? {userId: 'owner-id'} : null, headers: new Headers()}),
          verifiedAccount: async () => ({user: {id: actor.id ?? 'someone', email: 'x@example.test', email_confirmed_at: 'yes'}, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin,
          accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/access-control')) return {accountRole: async () => actor.kind === 'coach' ? {role: 'coach', staff: {email: 'coach@example.test', name: 'Coach', programs: ['Intermediate']}} : {role: 'family', staff: null}};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}

const ny = n => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0), longDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'});
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
sqlite.prepare('INSERT INTO academy_state VALUES (?,?,?,?,?)').run('academy', JSON.stringify({programNamingVersion: 2,
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}],
  events: [{id: 'camp', name: 'Takedown Camp', type: 'Camp', dates: [today], price: 160}]}), 1, 'owner', today);

// One family, every wrestler with a verified card, so only the documents decide.
const wrestlers = [
  {id: 'both', name: 'Bea Both', grade: '8', usawNumber: 'AB2001', usawExpires: '2099-08-31'},
  {id: 'waiver', name: 'Wes Waiveronly', grade: '8', usawNumber: 'AB2002', usawExpires: '2099-08-31'},
  {id: 'none', name: 'Nora Nothing', grade: '8', usawNumber: 'AB2003', usawExpires: '2099-08-31'},
  {id: 'excused', name: 'Eva Excused', grade: '8', usawNumber: 'AB2004', usawExpires: '2099-08-31'}
];
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('p1', 'p1@example.test', JSON.stringify({parentName: 'Pat', phone: '555', wrestlers}), 1, today);
let n = 0;
for (const w of wrestlers) {
  sqlite.prepare("INSERT OR REPLACE INTO usaw_reviews(user_id,wrestler_id,number,expires,status,note,reviewed_by,reviewed_at) VALUES ('p1',?,?,?,'valid','','owner-id','x')").run(w.id, w.usawNumber, w.usawExpires);
  sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end)
    VALUES (?,'p1','x',?,?,'monthly','Intermediate','Intermediate','label','[]',20000,0,20000,'usd','{}','{}','paid',?,0,?,?,?,?,?)`).run('m' + ++n, w.id, w.name, 'k' + n, today, today, today, ny(-10), ny(20));
  sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at)
    VALUES (?,'p1','x',?,?,'event',NULL,'camp','Camp',?,16000,0,16000,'usd','{}','{}','paid',?,0,?,?)`).run('e' + n, w.id, w.name, JSON.stringify([today]), 'ke' + n, today, today);
}
const publish = (id, kind, title, at) => sqlite.prepare("INSERT INTO waiver_versions(id,title,body,sha256,published_at,published_by,retired_at,kind) VALUES (?,?,'Text','x',?,'owner-id',NULL,?)").run(id, title, at, kind);
let s = 0;
const sign = (version, w) => sqlite.prepare("INSERT INTO waiver_signatures(id,version_id,user_id,wrestler_id,wrestler_name,signer,email,signature_record,signed_at,round) VALUES (?,?,'p1',?,?,'Pat','p1@example.test','{}',?,1)").run('sig' + ++s, version, w.id, w.name, today);
const except = (w, rule) => sqlite.prepare("INSERT INTO booking_exceptions(id,user_id,wrestler_id,rule,starts_on,ends_on,reason,created_by,created_at) VALUES (?,'p1',?,?,?,?,'Paper form in the office','owner-id',?)").run('ex-' + w + rule, w, rule, ny(-1), ny(5), today);

const roster = load(path.resolve('lib/roster.ts'));
const api = load(path.resolve('app/api/roster/route.ts'));
const passes = load(path.resolve('lib/passes.ts'));
const waivers = load(path.resolve('lib/waivers.ts'));
const ORIGIN = 'https://savage.test';
const post = async (route, b) => { const r = await route.POST(new Request(ORIGIN + '/x', {method: 'POST', headers: {'content-type': 'application/json', origin: ORIGIN}, body: JSON.stringify(b)})); return {status: r.status, body: await r.json()}; };
const owner = {role: 'owner'}, coach = {role: 'coach', programs: ['Intermediate']};
const sessionOf = async (prefix, scope = owner) => (await roster.rosterFor(today, scope)).find(x => x.key.startsWith(prefix));
const entryOf = async (id, prefix = 'practice:Intermediate:', scope = owner) => (await sessionOf(prefix, scope)).entries.find(e => e.wrestlerId === id);
const checkin = async (id, prefix = 'practice:Intermediate:', as = {kind: 'owner'}) => { actor = as; const x = await sessionOf(prefix, as.kind === 'coach' ? coach : owner); return post(api, {action: 'checkin', date: today, sessionKey: x.key, userId: 'p1', wrestlerId: id}); };
const undo = async (id, prefix = 'practice:Intermediate:') => { actor = {kind: 'owner'}; const x = await sessionOf(prefix); return post(api, {action: 'undo', date: today, sessionKey: x.key, userId: 'p1', wrestlerId: id}); };

// ---------- No document published: nothing is asked ----------
{
  const e = await entryOf('none');
  assert.deepEqual([e.waiverSigned, e.consentSigned, [...e.documentsMissing], e.checkInBlocked], [null, null, [], null]);
  assert.equal((await checkin('none')).status, 200); assert.equal((await undo('none')).status, 200);
}

// ---------- The waiver published: unsigned wrestlers are held, at the practice and at the camp ----------
publish('w1', 'waiver', 'Savage Wrestling Academy Waiver 2026', ny(-2) + 'T12:00:00Z');
for (const id of ['both', 'waiver']) sign('w1', wrestlers.find(w => w.id === id));
except('excused', 'waiver');
{
  const nora = await entryOf('none');
  assert.deepEqual([nora.waiverSigned, nora.consentSigned, [...nora.documentsMissing]], [false, null, ['waiver']]);
  assert.equal(nora.cardBlock, null, 'the card is fine');
  assert.equal(nora.checkInBlocked, "Nora Nothing can't be checked in: the waiver is not signed. A parent signs in their family account. No exception lets a wrestler in without it.");
  const r = await checkin('none');
  assert.equal(r.status, 409); assert.equal(r.body.error, nora.checkInBlocked);
  const atCamp = await checkin('none', 'event:camp:');
  assert.equal(atCamp.status, 409, 'a camp too'); assert.match(atCamp.body.error, /the waiver is not signed/);
  // Coaches read their own next step.
  assert.equal((await entryOf('none', 'practice:Intermediate:', coach)).checkInBlocked, "Nora Nothing can't be checked in: the waiver is not signed. Ask a parent to sign in their family account.");
  assert.equal((await checkin('none', 'practice:Intermediate:', {kind: 'coach', id: 'coach-id'})).status, 409);
  // The owner's waiver exception lets Eva book, but not in at the door.
  const eva = await entryOf('excused');
  assert.deepEqual([...eva.exceptions], ['waiver']); assert.deepEqual([...eva.documentsMissing], ['waiver']);
  assert.equal(await waivers.waiverProblem('p1', {id: 'excused', name: 'Eva Excused'}, [today]), null, 'booking still honors the exception');
  assert.equal((await checkin('excused')).status, 409, 'no exception at the door');
  assert.equal((await checkin('both')).status, 200); assert.equal((await checkin('waiver')).status, 200);
  // The cards page counts card problems only.
  const cards = load(path.resolve('app/api/usaw-cards/route.ts'));
  actor = {kind: 'owner'};
  const list = await (await cards.GET(new Request(ORIGIN + '/api/usaw-cards?show=all'))).json();
  assert.equal(list.cards.length, 4); assert.equal(list.totals.blockedToday, 0, 'an unsigned waiver is not a card problem');
}

// ---------- The Parent Consent Form published too: both are needed ----------
publish('c1', 'parent_consent', 'Parent Consent Form', ny(-1) + 'T12:00:00Z');
sign('c1', wrestlers.find(w => w.id === 'both'));
{
  const wes = await entryOf('waiver');
  assert.deepEqual([wes.waiverSigned, wes.consentSigned, [...wes.documentsMissing]], [true, false, ['parent_consent']]);
  assert.equal(wes.checkInBlocked, "Wes Waiveronly can't be checked in: the Parent Consent Form is not signed. A parent signs in their family account. No exception lets a wrestler in without it.");
  assert.ok(wes.checkedInAt, 'checked in before the form was published stays checked in');
  await undo('waiver');
  assert.equal((await checkin('waiver')).status, 409);
  const nora = await entryOf('none');
  assert.equal(nora.checkInBlocked, "Nora Nothing can't be checked in: the waiver and the Parent Consent Form are not signed. A parent signs in their family account. No exception lets a wrestler in without it.");
  except('excused', 'parent_consent');
  assert.equal((await checkin('excused')).status, 409, 'still no exception at the door');
  // A pass scan follows the same rule.
  const code = (await passes.familyPasses('p1')).find(p => p.wrestlerId === 'waiver').code;
  const scan = await passes.scanCheckIn(today, code, owner, 'owner-id', 18 * 60);
  assert.equal(scan.status, 409, 'a pass scan is held too'); assert.match(scan.error, /the Parent Consent Form is not signed/);
  // Signing lets the wrestler in straight away.
  sign('c1', wrestlers.find(w => w.id === 'waiver'));
  assert.equal((await checkin('waiver')).status, 200);
  // Both reasons when the card is also a problem: the card first, then the forms.
  const fam = JSON.parse(sqlite.prepare("SELECT payload FROM family_accounts WHERE user_id='p1'").get().payload);
  fam.wrestlers.find(w => w.id === 'none').usawExpires = ny(-1);
  sqlite.prepare("UPDATE family_accounts SET payload=? WHERE user_id='p1'").run(JSON.stringify(fam));
  sqlite.prepare("DELETE FROM usaw_reviews WHERE wrestler_id='none'").run();
  const both = await entryOf('none');
  assert.ok(both.cardBlock); assert.match(both.checkInBlocked, /^Nora Nothing can't be checked in: the USA Wrestling card expired .* Nora Nothing can't be checked in: the waiver and the Parent Consent Form are not signed\./);
}

// ---------- A retired document no longer counts ----------
sqlite.prepare("UPDATE waiver_versions SET retired_at=? WHERE id='c1'").run(today + 'T13:00:00Z');
{
  const eva = await entryOf('excused');
  assert.deepEqual([eva.consentSigned, [...eva.documentsMissing]], [null, ['waiver']], 'only the waiver is asked now');
}

// ---------- The roster page: badges, the hold line and the owner's links ----------
{
  const html = readFileSync('app/roster/screen.html', 'utf8');
  assert.match(html, /<span class="badge warn">Consent form not signed<\/span>/);
  assert.match(html, /Owner waiver exception: booking only/);
  assert.match(html, /until their USA Wrestling card or signed forms are sorted out/);
}

console.log('Check-in documents (#402): nothing asked while no document is published; an unsigned waiver or Parent Consent Form holds a wrestler at practices and camps, by hand and by scan, for the owner and coaches, with each reason in plain words; no exception at the door while booking keeps it; signing lets them in at once; card and form reasons together; a retired document stops counting; the cards page counts card problems only.');
