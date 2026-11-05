// Issues #18 and #19: Stripe Checkout for one-time purchases and the signed, idempotent webhook.
// Runs the real routes against in-memory SQLite and a fake Stripe client.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const stmt = (sql, args) => sqlite.prepare(sql);
const DB = {
  prepare(sql) {
    let args = [];
    return {
      bind(...v) { args = v; return this; },
      async first() { return stmt(sql).get(...args) ?? null; },
      async all() { return {results: stmt(sql).all(...args)}; },
      async run() { return {meta: stmt(sql).run(...args)}; },
      _execute() { const s = stmt(sql); return s.columns().length ? {results: s.all(...args)} : {results: [], meta: s.run(...args)}; }
    };
  },
  async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(s => s._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }
};
const WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests';
const env = {DB, STRIPE_TEST_WEBHOOK_SECRET: WEBHOOK_SECRET, CHECKOUT_KINDS: 'walkin,annual,event,live,monthly', STRIPE_CONFIG_ENCRYPTION_KEY: 'ab'.repeat(32)};

// Fake Stripe: records sessions, can be told to fail, and refuses to expire a session that was paid.
const stripe = {sessions: [], expired: [], failCreate: false, paidSessions: new Set(), counter: 0};
function StripeMock() {
  return {
    accounts: {retrieve: async id => ({id})},
    checkout: {sessions: {
      create: async (params, opts) => {
        if (stripe.failCreate) throw new Error('Stripe unavailable');
        const n = ++stripe.counter, s = {id: `cs_test_${n}`, url: `https://checkout.stripe.test/${n}`, livemode: false, params, opts};
        stripe.sessions.push(s); return s;
      },
      expire: async id => { if (stripe.paidSessions.has(id)) throw new Error('already complete'); stripe.expired.push(id); return {id, status: 'expired'}; }
    }}
  };
}
StripeMock.createFetchHttpClient = () => ({});

let actor = {id: 'parent-1', email: 'pat@example.test', email_confirmed_at: '2026-10-01', strong: true};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  vm.runInNewContext(code, {module, exports: module.exports, crypto, TextEncoder, TextDecoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
    require(name) {
      if (name === 'cloudflare:workers') return {env};
      if (name === 'stripe') return StripeMock;
      if (name.endsWith('/account-auth')) return {strongAccount: async () => ({user: actor, strong: actor?.strong, headers: new Headers()}), sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
      if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
      throw Error('unexpected import ' + name);
    }});
  return module.exports;
}

// Academy setup: one program with a daily schedule, a camp, and Friday Night Live.
const day = n => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const practiceDate = day(5), campStart = day(10), campEnd = day(11), liveDate = day(6);
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const state = {
  programNamingVersion: 2,
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [{program: 'Intermediate', start: day(-1), end: day(60), weekly: weekdays.map(d => ({day: d, start: '18:00', end: '19:30'})), excludedDates: []}],
  events: [{id: 'camp-1', name: 'Takedown Camp', type: 'Camp', dates: [campStart, campEnd], price: 160, slots: 20}],
  extraPractices: [{id: 'live-1', name: 'Friday Night Live', dates: [liveDate], enabled: true, start: '18:00', end: '19:00', memberCents: 1000, nonMemberCents: 2000}]
};
sqlite.prepare('INSERT INTO academy_state VALUES (?,?,?,?,?)').run('academy', JSON.stringify(state), 1, 'owner', day(0));
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('parent-1', 'pat@example.test', JSON.stringify({parentName: 'Pat Parent', phone: '', wrestlers: [{id: 'w-1', name: 'Sam Example', grade: '8'}]}), 1, day(0));

const vault = load(path.resolve('lib/stripe-test.ts'));
sqlite.prepare('INSERT INTO integration_secrets VALUES (?,?,?,?)').run('stripe-test', await vault.sealStripeKey('rk_test_' + 'x'.repeat(24)), 'owner', day(0));

const checkoutRoute = load(path.resolve('app/api/checkout/route.ts'));
const webhookRoute = load(path.resolve('app/api/stripe-webhook/route.ts'));
const bookingRoute = load(path.resolve('app/api/booking-review/route.ts'));
const registrationRoute = load(path.resolve('app/api/registration/route.ts'));
const webhookLib = load(path.resolve('lib/stripe-webhook.ts'));
const {verifyStripeSignature} = webhookLib;
// Objects made inside the VM sandbox have a different prototype, so compare plain copies.
const membershipTerm = d => JSON.parse(JSON.stringify(webhookLib.membershipTerm(d)));

const ORIGIN = 'https://savage.example.test';
const post = (route, body, origin = ORIGIN) => route.POST(new Request(ORIGIN + '/api/x', {method: 'POST', headers: {'content-type': 'application/json', origin}, body: JSON.stringify(body)}));
const pay = body => post(checkoutRoute, {acceptTerms: true, ...body});
const order = id => ({...sqlite.prepare('SELECT * FROM orders WHERE id=?').get(id)});
const sign = (raw, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
let eventN = 0;
const deliver = async (type, object, {id = `evt_${++eventN}`, signature, raw} = {}) => {
  const body = raw ?? JSON.stringify({id, type, livemode: false, data: {object}});
  const res = await webhookRoute.POST(new Request(ORIGIN + '/api/stripe-webhook', {method: 'POST', headers: {'stripe-signature': signature ?? sign(body), 'content-type': 'application/json'}, body}));
  return {status: res.status, body: await res.json(), id};
};
const sessionFor = o => ({id: o.stripe_session_id, object: 'checkout.session', client_reference_id: o.id, metadata: {order_id: o.id}, amount_total: o.amount_cents, currency: 'usd', livemode: false, payment_status: 'paid', payment_intent: 'pi_' + o.id.slice(0, 8)});
const camp = {source: 'booking', type: 'event', id: 'camp-1', wrestlerId: 'w-1', option: 'full'};

// --- Signature verification ---
{
  const raw = '{"id":"evt_x"}', now = Math.floor(Date.now() / 1000);
  assert.equal(await verifyStripeSignature(raw, sign(raw), WEBHOOK_SECRET), true);
  assert.equal(await verifyStripeSignature(raw, sign(raw, 'whsec_wrong'), WEBHOOK_SECRET), false, 'wrong secret');
  assert.equal(await verifyStripeSignature(raw + ' ', sign(raw), WEBHOOK_SECRET), false, 'tampered body');
  assert.equal(await verifyStripeSignature(raw, sign(raw, WEBHOOK_SECRET, now - 301), WEBHOOK_SECRET, now), false, 'too old');
  assert.equal(await verifyStripeSignature(raw, null, WEBHOOK_SECRET), false, 'missing header');
  assert.equal(await verifyStripeSignature(raw, `t=${now},v1=deadbeef,` + sign(raw).split(',')[1], WEBHOOK_SECRET, now), true, 'any matching v1 passes, as Stripe rotates secrets');
}

// --- Membership term arithmetic ---
assert.deepEqual(membershipTerm('2026-11-13'), {start: '2026-11-13', end: '2027-11-12'});
assert.deepEqual(membershipTerm('2028-02-29'), {start: '2028-02-29', end: '2029-02-28'});
assert.deepEqual(membershipTerm('2026-01-01'), {start: '2026-01-01', end: '2026-12-31'});

// --- Checkout is off unless configured ---
env.CHECKOUT_KINDS = '';
assert.equal((await pay(camp)).status, 403, 'closed when CHECKOUT_KINDS is empty');
let review = await (await post(bookingRoute, camp)).json();
assert.equal(review.paymentsEnabled, false); assert.match(review.review.message, /no payment/i);
env.CHECKOUT_KINDS = 'walkin,annual,event,live,monthly';
const savedSecret = env.STRIPE_TEST_WEBHOOK_SECRET; delete env.STRIPE_TEST_WEBHOOK_SECRET;
assert.equal((await pay(camp)).status, 403, 'closed without a webhook secret, since only webhooks can mark orders paid');
env.STRIPE_TEST_WEBHOOK_SECRET = savedSecret;
review = await (await post(bookingRoute, camp)).json();
assert.equal(review.paymentsEnabled, true); assert.match(review.review.message, /secure checkout/);

// --- Request guards ---
assert.equal((await post(checkoutRoute, camp)).status, 400, 'terms must be accepted');
assert.equal((await pay({...camp})).status === 200, true);
sqlite.exec("UPDATE orders SET status='canceled'");
assert.equal((await post(checkoutRoute, {acceptTerms: true, ...camp}, 'https://evil.test')).status, 403, 'cross-origin refused');
assert.equal((await pay({...camp, wrestlerId: 'someone-else'})).status, 404, 'cannot pay for another family');
assert.equal((await pay({source: 'booking', type: 'lesson', format: 'one-on-one', wrestlerId: 'w-1'})).status, 400, 'lessons stay inquiries');
env.CHECKOUT_KINDS = 'walkin,annual,event,live';
assert.equal((await pay({source: 'membership', program: 'Intermediate', plan: 'monthly', wrestlerId: 'w-1'})).status, 403, 'monthly stays closed unless listed (issue #20 waits on approved terms)');
env.CHECKOUT_KINDS = 'walkin,annual,event,live,monthly';

// --- Camp checkout: server price, browser amount ignored ---
let res = await pay({...camp, cents: 1, amountCents: 1, price: 1});
assert.equal(res.status, 200);
let body = await res.json();
assert.equal(body.amountCents, 16000, 'full camp price from settings, not the browser');
const first = order(body.orderId);
assert.equal(first.status, 'pending'); assert.equal(first.amount_cents, 16000); assert.equal(first.kind, 'event');
let session = stripe.sessions.at(-1);
assert.equal(session.params.line_items[0].price_data.unit_amount, 16000);
assert.equal(session.params.client_reference_id, first.id);
assert.equal(session.params.customer_email, 'pat@example.test');
assert.equal(session.params.success_url, `${ORIGIN}/family?checkout=success&order=${first.id}`);
assert.equal(session.opts.idempotencyKey, `order-${first.id}`);
assert.equal(first.stripe_session_id, session.id);

// --- Abandon and retry: old session expired, new order created ---
res = await pay(camp); body = await res.json();
assert.equal(res.status, 200);
assert.equal(order(first.id).status, 'expired'); assert.deepEqual(stripe.expired, [first.stripe_session_id]);
const second = order(body.orderId);

// --- Webhook security ---
let w = await deliver('checkout.session.completed', sessionFor(second), {signature: sign('different body')});
assert.equal(w.status, 400, 'bad signature refused');
assert.equal(order(second.id).status, 'pending');
w = await deliver('checkout.session.completed', {...sessionFor(second), amount_total: 100});
assert.equal(w.body.outcome, 'rejected:amount-mismatch'); assert.equal(order(second.id).status, 'pending');
assert.ok(sqlite.prepare("SELECT 1 FROM security_events WHERE action='stripe_event_rejected'").get(), 'rejections are logged');
w = await deliver('checkout.session.completed', {...sessionFor(second), livemode: true});
assert.equal(w.body.outcome, 'rejected:mode-mismatch');
w = await deliver('checkout.session.completed', {...sessionFor(second), id: 'cs_other'});
assert.equal(w.body.outcome, 'rejected:session-mismatch');

// --- Paid, then replayed and late events change nothing ---
const paidEvent = 'evt_paid_camp';
w = await deliver('checkout.session.completed', sessionFor(second), {id: paidEvent});
assert.equal(w.body.outcome, 'paid'); assert.equal(order(second.id).status, 'paid');
assert.ok(order(second.id).paid_at); assert.equal(order(second.id).stripe_payment_intent, 'pi_' + second.id.slice(0, 8));
assert.equal(order(second.id).term_end, null, 'events have no membership term');
w = await deliver('checkout.session.completed', sessionFor(second), {id: paidEvent});
assert.equal(w.body.duplicate, true, 'same event id is applied once');
w = await deliver('checkout.session.expired', sessionFor(second));
assert.equal(order(second.id).status, 'paid', 'a late expiry never un-pays an order');
assert.equal(w.body.outcome, 'ignored:already-paid', 'the event log says nothing changed');
assert.equal(sqlite.prepare("SELECT count(*) n FROM orders WHERE status='paid'").get().n, 1);

// --- Cannot buy the same thing twice ---
res = await pay(camp);
assert.equal(res.status, 409); assert.match((await res.json()).error, /already paid/);

// --- Refunds: partial is noted, full refund marks the order ---
const charge = {object: 'charge', payment_intent: order(second.id).stripe_payment_intent, refunded: false, amount_refunded: 5000};
w = await deliver('charge.refunded', charge);
assert.equal(w.body.outcome, 'partial-refund'); assert.equal(order(second.id).status, 'paid');
w = await deliver('charge.refunded', {...charge, refunded: true, amount_refunded: 16000});
assert.equal(w.body.outcome, 'refunded'); assert.equal(order(second.id).status, 'refunded');

// --- Upfront annual membership: term recorded, then member pricing everywhere ---
let live = await (await post(bookingRoute, {type: 'live', id: 'live-1', date: liveDate, wrestlerId: 'w-1'})).json();
assert.equal(live.review.cents, 2000, 'non-member price before membership');
res = await pay({source: 'membership', program: 'Intermediate', plan: 'annual', wrestlerId: 'w-1'});
body = await res.json(); assert.equal(res.status, 200); assert.equal(body.amountCents, 240000);
const annual = order(body.orderId);
await deliver('checkout.session.completed', sessionFor(annual));
const paidAnnual = order(annual.id);
assert.equal(paidAnnual.status, 'paid');
assert.deepEqual({start: paidAnnual.term_start, end: paidAnnual.term_end}, membershipTerm(day(0)));
live = await (await post(bookingRoute, {type: 'live', id: 'live-1', date: liveDate, wrestlerId: 'w-1'})).json();
assert.equal(live.review.cents, 1000, 'paid members get the Friday Night Live member price');
assert.equal(live.review.memberEligible, true);
const campReview = await (await post(bookingRoute, camp)).json();
assert.equal(campReview.review.cents, 14400, 'paid members get 10% off camps');
res = await post(registrationRoute, {program: 'Intermediate', plan: 'annual', wrestlerId: 'w-1'});
assert.equal(res.status, 409, 'cannot buy a second membership while one is active');

// --- Walk-in uses the scheduled practice and its date ---
res = await pay({source: 'membership', program: 'Intermediate', plan: 'walkin', wrestlerId: 'w-1', date: practiceDate, practiceId: `Intermediate:${practiceDate}:18:00`});
body = await res.json(); assert.equal(res.status, 200); assert.equal(body.amountCents, 4000);
assert.deepEqual(JSON.parse(order(body.orderId).dates), [practiceDate]);
res = await pay({source: 'membership', program: 'Intermediate', plan: 'walkin', wrestlerId: 'w-1', date: practiceDate, practiceId: 'Intermediate:1999-01-01:18:00'});
assert.equal(res.status, 409, 'a practice id that is not on the schedule for that date is refused');
res = await pay({source: 'membership', program: 'Intermediate', plan: 'walkin', wrestlerId: 'w-1', date: day(-3), practiceId: `Intermediate:${day(-3)}:18:00`});
assert.equal(res.status, 400, 'past practices are refused');

// --- Stripe outage: nothing charged, order released, retry works ---
stripe.failCreate = true;
res = await pay({source: 'booking', type: 'live', id: 'live-1', date: liveDate, wrestlerId: 'w-1'});
assert.equal(res.status, 502);
assert.equal(sqlite.prepare("SELECT status FROM orders WHERE kind='live' ORDER BY created_at DESC").get().status, 'canceled');
stripe.failCreate = false;
res = await pay({source: 'booking', type: 'live', id: 'live-1', date: liveDate, wrestlerId: 'w-1'});
assert.equal(res.status, 200);

// --- Payment completes on an old session after a retry: the paid one wins, the newer pending one is canceled ---
const liveOld = order((await res.json()).orderId);
stripe.paidSessions.add(liveOld.stripe_session_id);
res = await pay({source: 'booking', type: 'live', id: 'live-1', date: liveDate, wrestlerId: 'w-1'});
assert.equal(res.status, 409, 'cannot start a new checkout while the old one has already been paid at Stripe');
sqlite.prepare("UPDATE orders SET status='expired' WHERE id=?").run(liveOld.id);
res = await pay({source: 'booking', type: 'live', id: 'live-1', date: liveDate, wrestlerId: 'w-1'});
const liveNew = order((await res.json()).orderId);
await deliver('checkout.session.completed', sessionFor(liveOld));
assert.equal(order(liveOld.id).status, 'paid'); assert.equal(order(liveNew.id).status, 'canceled');

// --- A second completed payment for the same item is flagged for refund, not applied ---
sqlite.prepare("UPDATE orders SET status='expired' WHERE id=?").run(liveNew.id);
w = await deliver('checkout.session.completed', sessionFor(liveNew));
assert.equal(w.body.outcome, 'rejected:duplicate-payment-refund-needed'); assert.equal(order(liveNew.id).status, 'expired');

// --- Unknown or unrelated events are recorded and ignored ---
w = await deliver('customer.created', {id: 'cus_1'});
assert.equal(w.status, 200); assert.match(w.body.outcome, /^ignored/);
w = await deliver('checkout.session.completed', {...sessionFor(liveNew), client_reference_id: 'no-such-order', metadata: {}});
assert.equal(w.body.outcome, 'rejected:unknown-order');

console.log('Passed: checkout closed by default and per purchase type; server-side prices; terms and origin required; retry after abandoning; webhook signature, amount, mode and session checks; idempotent replays; late events; refunds; annual term dates; paid-member pricing; walk-ins; Stripe outages; double payments flagged.');
