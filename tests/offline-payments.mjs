// Issue #62: owner-recorded offline payments work everywhere online payments do, and can be voided.
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
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}, {id: 'Advanced', name: 'SWA Advance', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}],
  events: [{id: 'camp', name: 'Camp', type: 'Camp', dates: [ny(10)], price: 160, slots: 1}],
  extraPractices: [{id: 'fnl', name: 'Friday Night Live', dates: [today], enabled: true, start: '17:00', end: '18:00', memberCents: 1000, nonMemberCents: 2000}]}));
for (const [u, p] of [['p1', 'Pat One'], ['p2', 'Pat Two']]) sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test', JSON.stringify({parentName: p, phone: '555', wrestlers: [{id: 'w-' + u, name: 'Wrestler ' + u, grade: '8', usawNumber: 'TEST-1234', usawExpires: '2099-12-31'}]}), 1, 'x');

const api = load(path.resolve('app/api/payments/route.ts'));
const roster = load(path.resolve('lib/roster.ts'));
const quotes = load(path.resolve('lib/quotes.ts'));
const O = 'https://a.test';
const post = async (body, origin = O) => { const r = await api.POST(new Request(O + '/api/payments', {method: 'POST', headers: {'content-type': 'application/json', origin}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const get = async q => { const r = await api.GET(new Request(O + '/api/payments' + q)); return {status: r.status, text: await r.text(), type: r.headers.get('content-type')}; };
const rec = (extra) => post({action: 'record', userId: 'p1', wrestlerId: 'w-p1', method: 'cash', ...extra});
const onRoster = async (prefix, name) => (await roster.rosterFor(today, {role: 'owner'})).find(s => s.key.startsWith(prefix))?.entries.some(e => e.name === name) ?? false;

// --- Access ---
actor = {owner: false, id: 'p1'};
assert.equal((await get('')).status, 403); assert.equal((await post({action: 'preview'})).status, 403, 'families cannot record payments');
actor = {owner: true, id: 'owner-id'};
assert.equal((await post({action: 'record'}, 'https://evil.test')).status, 403, 'cross-origin refused');
const fams = JSON.parse((await get('?families=1')).text).families;
assert.equal(fams.length, 2); assert.equal(fams[0].wrestlers[0].name, 'Wrestler p1');

// --- Preview uses the same pricing as checkout ---
const walk = {kind: 'walkin', program: 'Intermediate', date: today, practiceId: `Intermediate:${today}:18:00`};
let r = await post({action: 'preview', userId: 'p1', wrestlerId: 'w-p1', ...walk});
assert.equal(r.status, 200); assert.equal(r.body.listCents, 4000); assert.equal(r.body.suggestedCents, 4000);
assert.equal((await post({action: 'preview', userId: 'p1', wrestlerId: 'w-p1', ...walk, program: 'Advanced'})).status, 403, 'Advance still needs approval');
assert.equal((await post({action: 'preview', userId: 'nobody', wrestlerId: 'w-p1', ...walk})).status, 404);

// --- Validation ---
assert.equal((await rec({...walk, method: 'bitcoin'})).status, 400, 'unknown method');
assert.equal((await rec({...walk, amountCents: 4001})).status, 400, 'cannot exceed the listed price');
assert.equal((await rec({...walk, paidOn: ny(2)})).status, 400, 'no future dates');
assert.equal((await rec({kind: 'monthly', program: 'Intermediate'})).status, 400, 'monthly is not an offline type');
// A year paid upfront is not offered, at the academy either (decision Q9 in #197, issue #210).
assert.equal((await rec({kind: 'annual', program: 'Intermediate', amountCents: 240000})).status, 400, 'no upfront year');
assert.equal((await post({action: 'preview', userId: 'p1', wrestlerId: 'w-p1', kind: 'annual', program: 'Intermediate'})).status, 400);
assert.doesNotMatch(readFileSync('app/payments/screen.html', 'utf8').match(/<select id="kind">[\s\S]*?<\/select>/)[0], /annual|paid in full|upfront/, 'the record form does not offer it');

// --- An upfront membership recorded before #210 still counts: roster, member pricing, and no double sale online ---
assert.equal(await onRoster('practice:Intermediate:', 'Wrestler p1'), false);
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
  VALUES ('legacy-annual','p1','p1@example.test','w-p1','Wrestler p1','annual','Intermediate','Intermediate','SWA Intermediate: 12-month membership, paid upfront','[]',240000,40000,200000,'usd',?,'{"offline":true}','paid','legacy-annual',0,'x','x',?,?,?,'offline')`)
  .run(JSON.stringify({method: 'check', note: 'Check 1042', recordedBy: 'owner-id'}), ny(-1) + 'T12:00:00.000Z', ny(-1), ny(363));
const order = sqlite.prepare("SELECT * FROM orders WHERE id='legacy-annual'").get();
assert.equal(await onRoster('practice:Intermediate:', 'Wrestler p1'), true, 'appears on the roster');
assert.equal(await quotes.isMember('p1', 'w-p1', today), true, 'gets member pricing');
assert.equal((await quotes.quoteMembership('p1', {wrestlerId: 'w-p1', program: 'Intermediate', plan: 'monthly'})).status, 409, 'online checkout will not sell a second membership');

// --- Walk-in and Friday Night Live for the other family ---
r = await post({action: 'record', userId: 'p2', wrestlerId: 'w-p2', kind: 'walkin', program: 'Intermediate', date: today, practiceId: `Intermediate:${today}:18:00`, method: 'cash'});
assert.equal(r.status, 200); assert.equal(await onRoster('practice:Intermediate:', 'Wrestler p2'), true);
assert.ok(sqlite.prepare("SELECT 1 FROM security_events WHERE action='offline_payment_recorded'").get());
const walkinId = r.body.orderId;
r = await post({action: 'record', userId: 'p2', wrestlerId: 'w-p2', kind: 'live', liveId: 'fnl', date: today, method: 'venmo'});
assert.equal(r.status, 200); assert.equal(sqlite.prepare('SELECT amount_cents FROM orders WHERE id=?').get(r.body.orderId).amount_cents, 2000, 'non-member Friday Night Live price');
assert.equal(await onRoster('live:fnl:', 'Wrestler p2'), true);

// --- Camp seat limits apply to offline payments too ---
assert.equal((await post({action: 'record', userId: 'p2', wrestlerId: 'w-p2', kind: 'event', eventId: 'camp', method: 'cash'})).status, 200);
assert.equal((await rec({kind: 'event', eventId: 'camp'})).status, 409, 'full camp refused');

// --- Comped spot: $0 is allowed ---
sqlite.prepare("UPDATE academy_state SET payload=json_set(payload,'$.events[0].slots',5)").run();
r = await rec({kind: 'event', eventId: 'camp', amountCents: 0, note: 'Comped by coach'});
assert.equal(r.status, 200); assert.equal(sqlite.prepare('SELECT amount_cents,discount_cents FROM orders WHERE id=?').get(r.body.orderId).discount_cents, 16000, 'a $0 comp discounts the full listed price');

// --- List, totals and CSV ---
let list = JSON.parse((await get('')).text);
assert.equal(list.totals.count, 5); assert.equal(list.totals.offlineCents, 200000 + 4000 + 2000 + 16000 + 0); assert.equal(list.totals.onlineCents, 0);
assert.equal(JSON.parse((await get('?kind=walkin')).text).payments.length, 1);
assert.equal(JSON.parse((await get('?kind=annual')).text).payments.length, 1, 'the old upfront payment stays in the history');
sqlite.prepare("UPDATE orders SET pricing=json_set(pricing,'$.note','=HYPERLINK(\"x\")') WHERE kind='walkin'").run();
const csv = await get('?format=csv');
assert.match(csv.type, /text\/csv/); assert.match(csv.text, /^Paid on,Status,Paid via/);
assert.match(csv.text, /"'=HYPERLINK\(""x""\)"/, 'spreadsheet formulas in notes are neutralized');

// --- Voiding ---
const membershipId = order.id;
assert.equal((await post({action: 'void', orderId: membershipId, reason: 'Check bounced'})).status, 200);
assert.equal(sqlite.prepare('SELECT status FROM orders WHERE id=?').get(membershipId).status, 'canceled');
assert.equal(await onRoster('practice:Intermediate:', 'Wrestler p1'), false, 'voided payment no longer counts');
assert.equal(await quotes.isMember('p1', 'w-p1', today), false);
assert.equal((await post({action: 'void', orderId: membershipId, reason: 'again'})).status, 409);
list = JSON.parse((await get('?status=canceled')).text);
assert.equal(list.payments[0].status, 'voided'); assert.equal(list.payments[0].voidReason, 'Check bounced');
assert.equal((await rec({kind: 'annual', program: 'Intermediate', method: 'cash'})).status, 400, 'a voided upfront year is not sold again');
assert.equal((await post({action: 'void', orderId: walkinId, reason: 'Wrong day'})).status, 200);
assert.equal((await post({action: 'record', userId: 'p2', wrestlerId: 'w-p2', kind: 'walkin', program: 'Intermediate', date: today, practiceId: `Intermediate:${today}:18:00`, method: 'cash'})).status, 200, 'can be re-recorded after a void');
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
  VALUES ('online1','p2','x','w-p2','W','event',NULL,'camp','Camp','[]',100,0,100,'usd','{}','{}','paid','k-online',0,'x','x',?,'stripe')`).run(today + 'T12:00:00Z');
assert.match((await post({action: 'void', orderId: 'online1', reason: 'x'})).body.error, /refunded in Stripe/, 'online payments are refunded in Stripe');

console.log('Passed: owner-only; preview uses checkout pricing and eligibility; validation; offline memberships, walk-ins, Friday Night Live and camps reach the roster, member pricing and duplicate checks; seat limits; comped spots; totals, filters and safe CSV; voiding removes access and allows re-recording; online payments are not voidable here.');
