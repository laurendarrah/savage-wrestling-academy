// Issue #89: owner exceptions to the USA Wrestling card and waiver booking blocks.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
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
    {module, exports: module.exports, crypto, btoa, TextEncoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          strongAccount: async () => ({user: {id: actor.id, email: actor.id + '@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.endsWith('/access-control')) return {accountRole: async () => actor.coach ? {role: 'coach', staff: {email: actor.coach, name: 'Coach Dana', programs: actor.programs ?? ['Intermediate']}} : {role: 'family', staff: null}};
        if (name.endsWith('/stripe-test')) return {storedStripeKeyFor: async () => null, stripeClientFor: () => null, stripeMode: () => 'test'};
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
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(90), weekly: all, excludedDates: []}],
  events: [{id: 'camp', name: 'Camp', type: 'Camp', dates: [ny(20), ny(40)], price: 100}]}));
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('p1', 'p1@example.test', JSON.stringify({parentName: 'Pat', phone: '', wrestlers: [{id: 'w1', name: 'Sam', grade: '8', usawNumber: 'AB1234', usawExpires: ny(-2)}]}), 1, 'x');

const api = load(path.resolve('app/api/exceptions/route.ts'));
const payments = load(path.resolve('app/api/payments/route.ts'));
const familyApi = load(path.resolve('app/api/family/route.ts'));
const waiverApi = load(path.resolve('app/api/waiver/route.ts'));
const waiversApi = load(path.resolve('app/api/waivers/route.ts'));
const quotes = load(path.resolve('lib/quotes.ts'));
const roster = load(path.resolve('lib/roster.ts'));
const O = 'https://a.test';
const call = async (route, method, body) => { const r = await route[method](new Request(O + '/x', method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const as = id => { actor = id === 'owner' ? {owner: true, id: 'owner-id'} : {owner: false, id}; };
const grant = (extra = {}) => { as('owner'); return call(api, 'POST', {action: 'grant', userId: 'p1', wrestlerId: 'w1', rule: 'usaw', endsOn: ny(30), reason: 'Renewal pending with USA Wrestling', ...extra}); };
const walkin = (k = 1) => quotes.quoteMembership('p1', {wrestlerId: 'w1', program: 'Intermediate', plan: 'walkin', date: ny(k), practiceId: `Intermediate:${ny(k)}:18:00`});

// --- Blocked without an exception ---
assert.match((await walkin()).error, /card expired/);

// --- Only the owner, with a reason and an end date within a year ---
as('p1'); assert.equal((await call(api, 'POST', {action: 'grant', userId: 'p1', wrestlerId: 'w1', rule: 'usaw', endsOn: ny(30), reason: 'please'})).status, 403);
assert.equal((await call(api, 'GET')).status, 403);
assert.equal((await grant({reason: ''})).status, 400);
assert.equal((await grant({endsOn: ny(-1)})).status, 400);
assert.equal((await grant({endsOn: ny(400)})).status, 400);
assert.equal((await grant({rule: 'grades'})).status, 400, 'only the card and waiver rules can be overridden');
assert.equal((await grant({wrestlerId: 'nobody'})).status, 404);
let r = await grant(); assert.equal(r.status, 200);
assert.equal(r.body.exceptions[0].wrestler, 'Sam'); assert.equal(r.body.exceptions[0].endsOn, ny(30));

// --- Bookings inside the dates go through; beyond them they are blocked ---
assert.equal((await walkin(1)).ok, true);
assert.match((await walkin(31)).error, /card expired/, 'after the exception ends');
assert.match((await quotes.quoteBooking('p1', {type: 'event', wrestlerId: 'w1', id: 'camp'})).error, /before this session ends/, 'camp runs past the exception');
as('owner'); r = await call(payments, 'POST', {action: 'record', userId: 'p1', wrestlerId: 'w1', kind: 'annual', program: 'Intermediate', method: 'cash'});
assert.equal(r.status, 200, 'owner-recorded payment allowed too');

// --- Families see that the academy is allowing it; the roster shows why ---
as('p1'); r = await call(familyApi, 'GET'); assert.equal(r.body.cards.w1.state, 'expired'); assert.equal(r.body.cards.w1.exceptionUntil, ny(30));
let entry = (await roster.rosterFor(today, {role: 'owner'})).find(s => s.key.startsWith('practice:')).entries[0];
assert.equal(entry.card, 'expired'); assert.equal(JSON.stringify(entry.exceptions), JSON.stringify(['usaw']));

// --- Waiver exceptions work the same way ---
as('owner'); assert.equal((await call(waiversApi, 'POST', {action: 'publish', title: 'Participation waiver', body: 'Wrestling is a contact sport. '.repeat(10)})).status, 200);
assert.match((await walkin()).error, /needs a signed Participation waiver/);
assert.equal((await grant({rule: 'waiver', endsOn: ny(7), reason: 'Paper waiver signed at the door'})).status, 200);
assert.equal((await walkin()).ok, true);
as('p1'); assert.equal((await call(waiverApi, 'GET')).body.exceptions.w1, ny(7));
entry = (await roster.rosterFor(today, {role: 'owner'})).find(s => s.key.startsWith('practice:')).entries[0];
assert.equal(JSON.stringify(entry.exceptions), JSON.stringify(['usaw', 'waiver']));

// --- Removing an exception blocks again; everything is logged ---
as('owner'); const card = (await call(api, 'GET')).body.exceptions.find(x => x.rule === 'usaw');
assert.equal((await call(api, 'POST', {action: 'remove', id: card.id})).status, 200);
assert.equal((await call(api, 'POST', {action: 'remove', id: card.id})).status, 404);
assert.match((await walkin()).error, /card expired/);
assert.deepEqual(sqlite.prepare("SELECT action FROM security_events WHERE action LIKE 'booking_exception%' ORDER BY rowid").all().map(x => x.action), ['booking_exception_granted', 'booking_exception_granted', 'booking_exception_removed']);

// --- Owner page helper (inline JavaScript is not typechecked) ---
{
  const html = readFileSync('app/cards/screen.html', 'utf8'), script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const start = script.indexOf('let exceptions=[];'), end = script.indexOf('function wireExceptions');
  const ctx = {Date, String, Intl, encodeURIComponent}; vm.runInNewContext("const esc=v=>String(v??'').replace(/[&<>\"']/g,'');" + script.slice(start, end).replace('let exceptions=[];', 'var exceptions=[];') + ';this.ctl=exceptionControls;this.set=v=>{exceptions=v}', ctx);
  assert.match(ctx.ctl('p1', 'w1', 'usaw'), /Allow booking anyway.*data-exc-grant="p1\|w1\|usaw"/s);
  ctx.set([{id: 'e1', userId: 'p1', wrestlerId: 'w1', rule: 'usaw', endsOn: '2027-01-15', reason: 'Renewal pending'}]);
  assert.match(ctx.ctl('p1', 'w1', 'usaw'), /Booking allowed until <strong>Jan 15, 2027<\/strong>.*Renewal pending.*data-exc-remove="e1"/s);
  assert.match(ctx.ctl('p1', 'w1', 'waiver'), /Allow booking anyway/, 'per rule');
}
console.log('Owner exception tests passed');
