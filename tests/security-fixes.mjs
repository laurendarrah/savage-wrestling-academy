// Issue #97: fixes from the security review of the new booking rules.
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
    {module, exports: module.exports, crypto, btoa, TextEncoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
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
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2,
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(90), weekly: all, excludedDates: []}],
  events: [{id: 'camp', name: 'Camp', type: 'Camp', dates: [ny(10), ny(11)], price: 160, day: 90, slots: 1}]}));
const fam = (u, wrestlers) => sqlite.prepare('INSERT OR REPLACE INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test', JSON.stringify({parentName: 'P ' + u, phone: '', wrestlers}), 1, 'x');
const card = {usawNumber: 'AB1234', usawExpires: '2099-12-31'};
for (const u of ['p1', 'p2']) fam(u, [{id: 'w-' + u, name: 'Wrestler ' + u, grade: '8', ...card}]);

const quotes = load(path.resolve('lib/quotes.ts'));
const payments = load(path.resolve('app/api/payments/route.ts'));
const waiversApi = load(path.resolve('app/api/waivers/route.ts'));
const waiverApi = load(path.resolve('app/api/waiver/route.ts'));
const exceptionsApi = load(path.resolve('app/api/exceptions/route.ts'));
const lessonsApi = load(path.resolve('app/api/lessons/route.ts'));
const backups = load(path.resolve('lib/backup-records.ts'));
const O = 'https://a.test';
const call = async (route, method, body) => { const r = await route[method](new Request(O + '/x', method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const as = id => { actor = id === 'owner' ? {owner: true, id: 'owner-id'} : {owner: false, id}; };

// --- 1. A full camp is full for the whole camp and for each single day (no waitlist offers since #210) ---
as('owner'); assert.equal((await call(payments, 'POST', {action: 'record', userId: 'p1', wrestlerId: 'w-p1', kind: 'event', eventId: 'camp', method: 'cash'})).status, 200);
let q = await quotes.quoteBooking('p2', {type: 'event', wrestlerId: 'w-p2', id: 'camp', option: 'full'});
assert.equal(q.ok, false); assert.equal(q.error, 'This event is full.');
q = await quotes.quoteBooking('p2', {type: 'event', wrestlerId: 'w-p2', id: 'camp', option: ny(10)});
assert.equal(q.ok, false, 'a single day of a full camp is full too'); assert.equal(q.error, 'This event is full.');

// --- 2. Coach emails never reach families ---
sqlite.prepare("INSERT INTO staff_access VALUES ('dana@example.test','Coach Dana','[]',1,'x')").run();
sqlite.prepare("INSERT INTO coach_openings(id,user_id,date,start,end,coach_email) VALUES ('o1','c',?,'16:00','17:00','dana@example.test')").run(ny(2));
as('p1'); let r = await call(lessonsApi, 'GET');
assert.equal(r.body.openings.length, 1); assert.equal(r.body.openings[0].coach, 'Coach Dana');
assert.ok(!JSON.stringify(r.body).includes('dana@example.test'), 'no coach email'); assert.match(r.body.openings[0].coachKey, /^[0-9a-f]{12}$/);

// --- 3. A waiver signature belongs to the named child ---
as('owner'); assert.equal((await call(waiversApi, 'POST', {action: 'publish', title: 'Waiver', body: 'Wrestling is a contact sport. '.repeat(10)})).status, 200);
as('p1'); const version = (await call(waiverApi, 'GET')).body.waiver.id;
const sign = () => call(waiverApi, 'POST', {versionId: version, wrestlerId: 'w-p1', signer: 'P p1', accepted: true, electronicConsent: true, signature: {method: 'drawn', strokes: [[[0.1, 0.5], [0.4, 0.4], [0.6, 0.6]]]}});
assert.equal((await sign()).status, 200);
const walkin = () => quotes.quoteMembership('p1', {wrestlerId: 'w-p1', program: 'Intermediate', plan: 'walkin', date: ny(1), practiceId: `Intermediate:${ny(1)}:18:00`});
assert.equal((await walkin()).ok, true);
fam('p1', [{id: 'w-p1', name: 'Younger Sibling', grade: '8', ...card}]);   // same entry renamed to another child
assert.match((await walkin()).error, /Younger Sibling needs a signed Waiver/, 'the signature does not carry over');
as('p1'); assert.equal((await call(waiverApi, 'GET')).body.signatures[0].current, false);
assert.equal((await sign()).status, 200, 'the new child can be signed for');
assert.equal((await walkin()).ok, true);

// --- 4. A waiver exception must cover the booked dates ---
fam('p2', [{id: 'w-p2', name: 'Wrestler p2', grade: '8', ...card}]);
as('owner'); assert.equal((await call(exceptionsApi, 'POST', {action: 'grant', userId: 'p2', wrestlerId: 'w-p2', rule: 'waiver', endsOn: ny(1), reason: 'Paper waiver at the door'})).status, 200);
assert.equal((await quotes.quoteMembership('p2', {wrestlerId: 'w-p2', program: 'Intermediate', plan: 'walkin', date: ny(1), practiceId: `Intermediate:${ny(1)}:18:00`})).ok, true);
assert.match((await quotes.quoteMembership('p2', {wrestlerId: 'w-p2', program: 'Intermediate', plan: 'walkin', date: ny(5), practiceId: `Intermediate:${ny(5)}:18:00`})).error, /needs a signed Waiver/, 'practice after the exception ends');

// --- 5. Damaged backup JSON is refused ---
{
  const b = JSON.parse(JSON.stringify(await backups.readBackup()));
  // The test's academy settings are a minimal fixture, not a full saved state; leave them out of the file.
  b.academy = null;
  assert.equal(backups.validBackup(b), true);
  const bad = JSON.parse(JSON.stringify(b)); bad.records.orders[0].dates = '{not json'; assert.equal(backups.validBackup(bad), false, 'malformed dates');
  const bad2 = JSON.parse(JSON.stringify(b)); bad2.records.orders[0].pricing = '[]'; assert.equal(backups.validBackup(bad2), false, 'pricing must be an object');
}
console.log('Security fix tests passed');
