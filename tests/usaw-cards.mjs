// Issue #68: a missing, expired or rejected USA Wrestling card blocks booking; the owner reviews cards; rosters warn.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {
  prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; },
    _execute() { const s = sqlite.prepare(sql); return s.columns().length ? {results: s.all(...a)} : {results: [], meta: s.run(...a)}; }}; },
  async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(s => s._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }
};
const env = {DB};
let actor = {owner: true, id: 'owner-id'};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          strongAccount: async () => ({user: {id: actor.id, email: 'x@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}


const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0);
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2,
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}],
  events: [{id: 'camp', name: 'Two-day camp', type: 'Camp', dates: [ny(10), ny(11)], price: 160, day: 90}],
  extraPractices: [{id: 'fnl', name: 'Friday Night Live', dates: [ny(3)], enabled: true, start: '17:00', end: '18:00', memberCents: 1000, nonMemberCents: 2000}]}));
const setCard = (number, expires) => sqlite.prepare('INSERT OR REPLACE INTO family_accounts VALUES (?,?,?,?,?)')
  .run('p1', 'p1@example.test', JSON.stringify({parentName: 'Pat One', phone: '555', wrestlers: [{id: 'w1', name: 'Sam', grade: '8', ...(number === undefined ? {} : {usawNumber: number, usawExpires: expires})}]}), 1, 'x');

const usaw = load(path.resolve('lib/usaw.ts'));
const quotes = load(path.resolve('lib/quotes.ts'));
const records = load(path.resolve('lib/family-records.ts'));
const cardsApi = load(path.resolve('app/api/usaw-cards/route.ts'));
const payments = load(path.resolve('app/api/payments/route.ts'));
const familyApi = load(path.resolve('app/api/family/route.ts'));
const roster = load(path.resolve('lib/roster.ts'));
const O = 'https://a.test';
const call = async (route, method, body, origin = O) => { const r = await route[method](new Request(O + '/x', method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const walkin = () => quotes.quoteMembership('p1', {wrestlerId: 'w1', program: 'Intermediate', plan: 'walkin', date: ny(1), practiceId: `Intermediate:${ny(1)}:18:00`});
const annual = () => quotes.quoteMembership('p1', {wrestlerId: 'w1', program: 'Intermediate', plan: 'annual'});
const live = () => quotes.quoteBooking('p1', {type: 'live', wrestlerId: 'w1', id: 'fnl', date: ny(3)});
const camp = option => quotes.quoteBooking('p1', {type: 'event', wrestlerId: 'w1', id: 'camp', option});
const blockedBy = (q, text) => { assert.equal(q.ok, false); assert.equal(q.status, 403); assert.equal(q.extra?.usawRequired, true); assert.match(q.error, text); };

// --- Card status rules ---
const W = {id: 'w1', name: 'Sam'};
assert.equal(usaw.cardStatus(W, null, today).state, 'missing');
assert.equal(usaw.cardStatus({...W, usawNumber: 'AB12'}, null, today).state, 'missing', 'number without a date is incomplete');
assert.equal(usaw.cardStatus({...W, usawNumber: 'AB12', usawExpires: ny(-1)}, null, today).state, 'expired');
assert.equal(usaw.cardStatus({...W, usawNumber: 'AB12', usawExpires: today}, null, today).state, 'current', 'valid through its expiration date');
const review = {number: 'AB12', expires: ny(30), status: 'invalid', note: 'number not found', reviewed_at: 'x'};
assert.equal(usaw.cardStatus({...W, usawNumber: 'ab12', usawExpires: ny(30)}, review, today).state, 'invalid', 'numbers compare case-insensitively');
assert.equal(usaw.cardStatus({...W, usawNumber: 'AB13', usawExpires: ny(30)}, review, today).state, 'recheck', 'after a rejection, an edited card waits for the academy (issue #97)');
assert.equal(usaw.cardStatus({...W, usawNumber: 'A-B12', usawExpires: ny(30)}, review, today).state, 'invalid', 'a dash does not get around a rejection');
assert.equal(usaw.cardStatus({...W, usawNumber: 'AB13', usawExpires: ny(30)}, {...review, status: 'valid'}, today).state, 'current', 'editing a verified card just needs a fresh check');
assert.equal(usaw.cardStatus({...W, usawNumber: 'AB12', usawExpires: ny(30)}, {...review, status: 'valid'}, today).state, 'verified');

// --- Family profile validation ---
const fam = w => records.validFamily({parentName: 'P', phone: '', wrestlers: [{id: 'w1', name: 'Sam', grade: '8', ...w}]});
assert.equal(fam({}), true, 'a card is optional when saving');
assert.equal(fam({usawNumber: 'AB-1234', usawExpires: '2027-08-31'}), true);
assert.equal(fam({usawNumber: '<script>', usawExpires: '2027-08-31'}), false);
assert.equal(fam({usawNumber: 'AB1234', usawExpires: '2027-02-30'}), false, 'real calendar dates only');
assert.equal(records.cleanFamily({parentName: 'P', phone: '', wrestlers: [{id: 'w1', name: 'Sam', grade: '8', usawNumber: ' ab1234 ', usawExpires: '2027-08-31'}]}).wrestlers[0].usawNumber, 'AB1234');

// --- Missing and expired cards block every purchase type ---
setCard(undefined);
for (const q of [await walkin(), await annual(), await live(), await camp('full')]) blockedBy(q, /needs a current USA Wrestling card/);
blockedBy(await quotes.quoteBooking('p1', {type: 'lesson', wrestlerId: 'w1', format: 'one-on-one'}), /needs a current USA Wrestling card/);
setCard('AB1234', ny(-1));
blockedBy(await walkin(), /card expired on/);
blockedBy(await annual(), /card expired on/);

// --- The card must cover the session date, and every day of a multi-day event ---
setCard('AB1234', ny(2));
assert.equal((await walkin()).ok, true, 'walk-in tomorrow is covered');
blockedBy(await live(), /expired on/);
setCard('AB1234', ny(10));
blockedBy(await camp('full'), /before this session ends/);
{ const q = await camp(ny(10)); assert.equal(q.ok, true, 'the first camp day alone is covered: ' + q.error); }
setCard('AB1234', ny(11));
assert.equal((await camp('full')).ok, true);

// --- Offline payments go through the same check ---
setCard('AB1234', ny(-5));
let r = await call(payments, 'POST', {action: 'record', userId: 'p1', wrestlerId: 'w1', kind: 'walkin', program: 'Intermediate', date: ny(1), practiceId: `Intermediate:${ny(1)}:18:00`, method: 'cash'});
assert.equal(r.status, 403); assert.match(r.body.error, /USA Wrestling card expired/);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM orders').get().n, 0, 'nothing recorded');

// --- Owner review ---
setCard('AB1234', ny(200));
actor = {owner: false, id: 'p1'};
assert.equal((await call(cardsApi, 'GET')).status, 403, 'families cannot list cards');
assert.equal((await call(cardsApi, 'POST', {userId: 'p1', wrestlerId: 'w1', status: 'valid', number: 'AB1234', expires: ny(200)})).status, 403);
actor = {owner: true, id: 'owner-id'};
let list = (await call(cardsApi, 'GET')).body.cards;
assert.equal(list.length, 1); assert.equal(list[0].state, 'current'); assert.equal(list[0].wrestler, 'Sam');
assert.equal((await call(cardsApi, 'POST', {userId: 'p1', wrestlerId: 'w1', status: 'valid', number: 'AB1234', expires: ny(200)}, 'https://evil.test')).status, 403);
assert.equal((await call(cardsApi, 'POST', {userId: 'p1', wrestlerId: 'w1', status: 'invalid', number: 'AB1234', expires: ny(200)})).status, 400, 'a reason is required');
assert.equal((await call(cardsApi, 'POST', {userId: 'p1', wrestlerId: 'w1', status: 'invalid', number: 'OLD1', expires: ny(200), note: 'x'})).status, 409, 'stale page');
assert.equal((await call(cardsApi, 'POST', {userId: 'p1', wrestlerId: 'nope', status: 'valid'})).status, 404);
assert.equal((await call(cardsApi, 'POST', {userId: 'p1', wrestlerId: 'w1', status: 'invalid', number: 'AB1234', expires: ny(200), note: 'Number not found'})).status, 200);
blockedBy(await walkin(), /could not verify Sam's USA Wrestling card \(Number not found\)/);
actor = {owner: false, id: 'p1'};
r = await call(familyApi, 'GET');
assert.equal(r.body.cards.w1.state, 'invalid', 'the family sees the review'); assert.equal(r.body.cards.w1.note, 'Number not found');
// The family corrects the number: booking stays blocked until the academy checks the new card (issue #97).
setCard('AB-1234', ny(200));
blockedBy(await walkin(), /could not verify/);
setCard('AB1235', ny(200));
blockedBy(await walkin(), /waiting for the academy to check it/);
assert.equal((await call(familyApi, 'GET')).body.cards.w1.state, 'recheck');
actor = {owner: true, id: 'owner-id'};
assert.equal((await call(cardsApi, 'POST', {userId: 'p1', wrestlerId: 'w1', status: 'valid', number: 'AB1235', expires: ny(200)})).status, 200);
list = (await call(cardsApi, 'GET')).body.cards; assert.equal(list[0].state, 'verified'); assert.ok(list[0].reviewedAt);
assert.equal((await call(cardsApi, 'POST', {userId: 'p1', wrestlerId: 'w1', status: 'clear'})).status, 200);
assert.equal((await call(cardsApi, 'GET')).body.cards[0].state, 'current');
assert.deepEqual(sqlite.prepare("SELECT action FROM security_events WHERE action LIKE 'usaw%' ORDER BY rowid").all().map(x => x.action), ['usaw_card_invalid', 'usaw_card_valid', 'usaw_card_review_cleared']);
// A future date shows whose card will have lapsed by then (for example a tournament day).
r = await cardsApi.GET(new Request(O + '/x?date=' + ny(201))); assert.equal((await r.json()).cards[0].state, 'expired');

// --- Roster: a paid member whose card later lapses still appears and can check in, with a warning ---
r = await call(payments, 'POST', {action: 'record', userId: 'p1', wrestlerId: 'w1', kind: 'annual', program: 'Intermediate', method: 'cash'});
assert.equal(r.status, 200);
let entry = (await roster.rosterFor(today, {role: 'owner'})).find(s => s.key.startsWith('practice:Intermediate:')).entries[0];
assert.equal(entry.card, 'current');
setCard('AB1235', ny(-1));
entry = (await roster.rosterFor(today, {role: 'owner'})).find(s => s.key.startsWith('practice:Intermediate:')).entries[0];
assert.equal(entry.name, 'Sam'); assert.equal(entry.card, 'expired'); assert.equal(entry.cardExpires, ny(-1));

// --- Family page helpers (inline JavaScript is not typechecked) ---
{
  const html = readFileSync('app/family/screen.html', 'utf8'), script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const pick = start => { const i = script.indexOf(start); assert.ok(i >= 0, start); return script.slice(i, script.indexOf('\n', i)); };
  const helpers = script.slice(script.indexOf('let cards={};'), script.indexOf('async function refreshCards'));
  const ctx = {Date, String, Intl};
  vm.runInNewContext(pick('const longDate=') + '\nconst esc=v=>String(v??"").replace(/[&<>"\']/g,"");\n' + helpers.replace('let cards={};', 'var cards={};') + '\nthis.cardLine=cardLine;this.setCards=c=>{cards=c};', ctx);
  assert.match(ctx.cardLine({id: 'a', name: 'A'}), /No USA Wrestling card.*Booking is blocked/);
  assert.match(ctx.cardLine({id: 'a', usawNumber: 'AB12', usawExpires: ny(-1)}), /expired.*Booking is blocked/);
  assert.match(ctx.cardLine({id: 'a', usawNumber: 'AB12', usawExpires: ny(10)}), /warning.*Renew soon/);
  assert.match(ctx.cardLine({id: 'a', usawNumber: 'AB12', usawExpires: ny(200)}), /active">USA Wrestling card on file/);
  ctx.setCards({a: {state: 'invalid', number: 'AB12', expires: ny(200), note: 'Number not found'}});
  assert.match(ctx.cardLine({id: 'a', usawNumber: 'AB12', usawExpires: ny(200)}), /Card not verified.*Number not found/);
  assert.match(ctx.cardLine({id: 'a', usawNumber: 'AB13', usawExpires: ny(200)}), /card on file/, 'an unsaved edit is judged locally');
}

console.log('USA Wrestling card tests passed');
