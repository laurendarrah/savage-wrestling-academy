// Issue #36: camps, clinics and events cannot be oversold online.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
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
const SECRET = 'whsec_capacity_unit';
const env = {DB, STRIPE_CONFIG_ENCRYPTION_KEY: '9a'.repeat(32), STRIPE_TEST_WEBHOOK_SECRET: SECRET, CHECKOUT_KINDS: 'event'};
let n = 0;
function StripeMock() { return {checkout: {sessions: {create: async () => ({id: 'cs_test_c' + ++n, url: 'https://checkout.stripe.test/c', livemode: false}), expire: async () => ({})}}}; }
StripeMock.createFetchHttpClient = () => ({});
let user = 'p1';
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText,
    {module, exports: module.exports, crypto, TextEncoder, TextDecoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name === 'stripe') return StripeMock;
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',strongAccount: async () => ({user: {id: user, email: user + '@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}), sameOrigin: () => true, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
const vault = load(path.resolve('lib/stripe-test.ts'));
const capacity = load(path.resolve('lib/capacity.ts'));
const checkout = load(path.resolve('app/api/checkout/route.ts'));
const booking = load(path.resolve('app/api/booking-review/route.ts'));
const webhook = load(path.resolve('app/api/stripe-webhook/route.ts'));

const day = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const d1 = day(10), d2 = day(11);
const setEvents = events => sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x') ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").run(JSON.stringify({programNamingVersion: 2, programs: [], events}));
setEvents([{id: 'camp', name: 'Camp', type: 'Camp', dates: [d1, d2], price: 160, day: 90, slots: 2}, {id: 'open', name: 'Open Clinic', type: 'Clinic', dates: [d1], price: 50}]);
for (const p of ['p1', 'p2', 'p3', 'p4', 'p5']) sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(p, p + '@example.test', JSON.stringify({parentName: p, phone: '', wrestlers: [{id: 'w-' + p, name: 'Wrestler ' + p, grade: '8', usawNumber: 'TEST-1234', usawExpires: '2099-12-31'}]}), 1, 'x');
sqlite.prepare("INSERT INTO integration_secrets VALUES ('stripe-test',?,?,?)").run(await vault.sealStripeKey('rk_test_' + 'c'.repeat(24)), 'o', 'x');

const req = (route, body) => route.POST(new Request('https://a.test/api/x', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://a.test'}, body: JSON.stringify(body)}));
const review = async (who, option = 'full', id = 'camp') => { user = who; const r = await req(booking, {type: 'event', id, option, wrestlerId: 'w-' + who}); return {status: r.status, body: await r.json()}; };
const pay = async (who, option = 'full', id = 'camp') => { user = who; const r = await req(checkout, {source: 'booking', type: 'event', id, option, wrestlerId: 'w-' + who, acceptTerms: true}); return {status: r.status, body: await r.json()}; };

// --- Seats are held by checkouts in progress and taken by payments ---
assert.equal((await review('p1')).body.review.seatsLeft, 2);
assert.equal((await pay('p1')).status, 200);
assert.equal((await review('p2')).body.review.seatsLeft, 1, 'a checkout in progress holds a seat');
const p2 = await pay('p2'); assert.equal(p2.status, 200);
let r = await review('p3');
assert.equal(r.status, 409); assert.match(r.body.error, /full/);
assert.equal((await pay('p3')).status, 409, 'checkout refuses a full event too');
assert.equal((await review('p3', d1)).status, 409, 'a single day is full when full-camp registrations hold it');
assert.equal((await review('p3', 'full', 'open')).body.review.seatsLeft, null, 'events without a limit are unlimited');

// --- An abandoned checkout releases its seat after the hold window ---
const p1order = sqlite.prepare("SELECT id FROM orders WHERE user_id='p1'").get().id;
sqlite.prepare('UPDATE orders SET created_at=? WHERE id=?').run(new Date(Date.now() - 40 * 60000).toISOString(), p1order);
assert.equal((await review('p3')).body.review.seatsLeft, 1, 'expired hold no longer counts');
assert.equal((await pay('p3')).status, 200);

// --- Paid registrations always count ---
sqlite.prepare("UPDATE orders SET status='paid' WHERE user_id='p2'").run();
sqlite.prepare("UPDATE orders SET created_at=? WHERE user_id='p2'").run(new Date(Date.now() - 600 * 60000).toISOString());
assert.equal((await review('p4')).status, 409, 'old paid order plus a live hold fill both seats');

// --- Racing for the last seat: the earlier order keeps it ---
sqlite.exec('DELETE FROM orders');
const hold = (id, at, dates = [d1, d2], status = 'pending') => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,stripe_session_id,livemode,created_at,updated_at)
  VALUES (?,?,'x','w','W','event',NULL,'camp','Camp',?,16000,0,16000,'usd',?,'{}',?,?,?,0,?,?)`).run(id, id, JSON.stringify(dates), JSON.stringify({slots: 2}), status, 'k-' + id, 'cs_' + id, at, at);
const t = s => new Date(Date.now() - s * 1000).toISOString();
hold('a', t(30)); hold('b', t(20)); hold('c', t(10));
assert.equal(await capacity.withinCapacity('a', 'camp', [d1, d2], 2), true);
assert.equal(await capacity.withinCapacity('b', 'camp', [d1, d2], 2), true);
assert.equal(await capacity.withinCapacity('c', 'camp', [d1, d2], 2), false, 'third order past the limit loses the race');

// --- Single days and full camps share seats per day ---
sqlite.exec('DELETE FROM orders');
setEvents([{id: 'camp', name: 'Camp', type: 'Camp', dates: [d1, d2], price: 160, day: 90, slots: 1}]);
assert.equal((await pay('p1', d1)).status, 200);
assert.equal((await pay('p2', d2)).status, 200, 'different single days do not compete');
assert.equal((await review('p3')).status, 409, 'a full camp needs a seat on every day');
assert.equal((await review('p3', d1)).status, 409);

// --- A late payment over the limit stands, and the owner is warned ---
sqlite.exec('DELETE FROM orders');
hold('paid1', t(3600), [d1, d2], 'paid');
hold('late', t(3600), [d1, d2], 'pending');
sqlite.prepare("UPDATE orders SET pricing=? WHERE id IN ('paid1','late')").run(JSON.stringify({slots: 1}));
const raw = JSON.stringify({id: 'evt_late', type: 'checkout.session.completed', livemode: false, data: {object: {id: 'cs_late', client_reference_id: 'late', metadata: {}, amount_total: 16000, currency: 'usd', livemode: false, payment_status: 'paid', payment_intent: 'pi_late'}}});
const ts_ = Math.floor(Date.now() / 1000);
const res = await webhook.POST(new Request('https://a.test/api/stripe-webhook', {method: 'POST', headers: {'stripe-signature': `t=${ts_},v1=${createHmac('sha256', SECRET).update(`${ts_}.${raw}`).digest('hex')}`}, body: raw}));
const out = await res.json();
assert.equal(out.outcome, 'paid-over-capacity');
assert.equal(sqlite.prepare("SELECT status FROM orders WHERE id='late'").get().status, 'paid', 'money was taken, so the order is paid');
assert.match(sqlite.prepare("SELECT target FROM security_events WHERE action='event_over_capacity'").get().target, /2 paid for 1 seats/);

console.log('Passed: event seats are held by checkouts in progress and taken by payments; expired holds release; full events refuse review and checkout; single days and full camps share per-day seats; the earlier order wins the last seat; late over-limit payments stand and warn the owner; events without a limit are unlimited.');
