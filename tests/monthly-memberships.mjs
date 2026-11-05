// Issue #20: 12-month memberships paid monthly. Exactly 12 charges, then the subscription ends by itself.
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
const SECRET = 'whsec_monthly_unit';
const env = {DB, STRIPE_CONFIG_ENCRYPTION_KEY: 'ef'.repeat(32), STRIPE_TEST_WEBHOOK_SECRET: SECRET, CHECKOUT_KINDS: 'monthly'};
const anchor = Math.floor(Date.UTC(2026, 10, 5, 15, 0, 0) / 1000);
const stripe = {sessions: [], updates: [], failUpdate: false, n: 0};
function StripeMock() {
  return {
    checkout: {sessions: {create: async params => { const s = {id: 'cs_test_m' + ++stripe.n, url: 'https://checkout.stripe.test/m', livemode: false, params}; stripe.sessions.push(s); return s; }, expire: async () => ({})}},
    subscriptions: {
      retrieve: async id => ({id, billing_cycle_anchor: anchor, start_date: anchor, metadata: {order_id: 'x'}}),
      update: async (id, params) => { if (stripe.failUpdate) throw new Error('Stripe down'); stripe.updates.push({id, params}); return {id}; }
    }
  };
}
StripeMock.createFetchHttpClient = () => ({});
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText,
    {module, exports: module.exports, crypto, TextEncoder, TextDecoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name === 'stripe') return StripeMock;
        if (name.endsWith('/account-auth')) return {strongAccount: async () => ({user: {id: 'p1', email: 'pat@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}), sameOrigin: () => true, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
const vault = load(path.resolve('lib/stripe-test.ts'));
const lib = load(path.resolve('lib/stripe-webhook.ts'));
const checkout = load(path.resolve('app/api/checkout/route.ts'));
const webhook = load(path.resolve('app/api/stripe-webhook/route.ts'));

// --- Paid-through dates follow Stripe's monthly billing, including short months ---
assert.equal(lib.paidThroughAfter('2026-11-05', 1), '2026-12-04');
assert.equal(lib.paidThroughAfter('2026-11-05', 11), '2027-10-04');
assert.equal(lib.paidThroughAfter('2027-01-31', 1), '2027-02-27', 'Jan 31 bills next on Feb 28');
assert.equal(lib.paidThroughAfter('2027-01-31', 2), '2027-03-30', 'then on Mar 31');

// --- Setup ---
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
sqlite.prepare('INSERT INTO academy_state VALUES (?,?,?,?,?)').run('academy', JSON.stringify({programNamingVersion: 2, programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000}], seasons: []}), 1, 'o', today);
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('p1', 'pat@example.test', JSON.stringify({parentName: 'Pat', phone: '', wrestlers: [{id: 'w1', name: 'Sam', grade: '8', usawNumber: 'TEST-1234', usawExpires: '2099-12-31'}]}), 1, today);
sqlite.prepare("INSERT INTO integration_secrets VALUES ('stripe-test',?,?,?)").run(await vault.sealStripeKey('rk_test_' + 'm'.repeat(24)), 'o', today);

// --- Checkout creates a monthly subscription for the server price ---
const res = await checkout.POST(new Request('https://a.test/api/checkout', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://a.test'}, body: JSON.stringify({source: 'membership', program: 'Intermediate', plan: 'monthly', wrestlerId: 'w1', acceptTerms: true, amountCents: 1})}));
const {orderId} = await res.json();
assert.equal(res.status, 200);
const params = stripe.sessions[0].params;
assert.equal(params.mode, 'subscription');
assert.deepEqual(JSON.parse(JSON.stringify(params.line_items[0].price_data)), {currency: 'usd', unit_amount: 20000, recurring: {interval: 'month'}, product_data: {name: 'SWA Intermediate: 12-month membership, monthly payment', description: 'For Sam'}});
assert.equal(params.subscription_data.metadata.order_id, orderId);
assert.equal(params.payment_intent_data, undefined, 'not allowed in subscription mode');

// --- Webhook helpers ---
const sign = raw => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')}`; };
let ev = 0;
const deliver = async (type, object, id = 'evt_m' + ++ev) => {
  const raw = JSON.stringify({id, type, livemode: false, data: {object}});
  const r = await webhook.POST(new Request('https://a.test/api/stripe-webhook', {method: 'POST', headers: {'stripe-signature': sign(raw)}, body: raw}));
  return {status: r.status, body: await r.json(), id};
};
const order = () => sqlite.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
const sub = () => sqlite.prepare('SELECT * FROM subscriptions WHERE order_id=?').get(orderId);
const completed = {id: order().stripe_session_id, mode: 'subscription', client_reference_id: orderId, metadata: {order_id: orderId}, amount_total: 20000, currency: 'usd', livemode: false, payment_status: 'paid', subscription: 'sub_1'};
const invoice = (reason, amount = 20000, extra = {}) => ({id: 'in_' + ++ev, billing_reason: reason, amount_paid: amount, parent: {subscription_details: {subscription: 'sub_1'}}, ...extra});

// --- A later invoice arriving before checkout completion is retried, not lost ---
let w = await deliver('invoice.paid', invoice('subscription_cycle'));
assert.equal(w.status, 500, 'Stripe retries an invoice for a subscription not recorded yet');
assert.equal(sqlite.prepare("SELECT count(*) n FROM stripe_events WHERE type='invoice.paid'").get().n, 0);

// --- Stripe outage while setting the 12-payment end: nothing recorded, Stripe retries ---
stripe.failUpdate = true;
w = await deliver('checkout.session.completed', completed, 'evt_complete');
assert.equal(w.status, 500); assert.equal(order().status, 'pending'); assert.equal(sub(), undefined);
stripe.failUpdate = false;

// --- Checkout completes: payment 1 of 12, end date set at Stripe ---
w = await deliver('checkout.session.completed', completed, 'evt_complete');
assert.equal(w.status, 200); assert.equal(w.body.outcome, 'paid');
assert.equal(order().status, 'paid');
assert.equal(order().term_start, today);
assert.equal(order().term_end, lib.paidThroughAfter(today, 1), 'access runs through the paid month');
assert.equal(sub().payments_made, 1); assert.equal(sub().payments_total, 12); assert.equal(sub().status, 'active');
assert.equal(sub().term_end, JSON.parse(JSON.stringify(lib.membershipTerm(today))).end);
assert.equal(stripe.updates.length, 1);
assert.equal(stripe.updates[0].id, 'sub_1');
assert.equal(stripe.updates[0].params.cancel_at, Math.floor(Date.UTC(2027, 10, 5, 15, 0, 0) / 1000), 'ends exactly 12 months after the billing anchor');
assert.equal(stripe.updates[0].params.proration_behavior, 'none');
assert.equal(sub().cancel_at, '2027-11-05T15:00:00.000Z');

// --- The first invoice is not counted twice ---
w = await deliver('invoice.paid', invoice('subscription_create'));
assert.equal(w.body.outcome, 'ignored:first-payment-counted-at-checkout'); assert.equal(sub().payments_made, 1);

// --- Failed payment, then recovery ---
w = await deliver('invoice.payment_failed', invoice('subscription_cycle'));
assert.equal(w.body.outcome, 'installment-failed'); assert.equal(sub().status, 'past_due');
assert.equal(order().term_end, lib.paidThroughAfter(today, 1), 'access is not extended by a failed payment');
w = await deliver('invoice.paid', invoice('subscription_cycle', 100));
assert.equal(w.body.outcome, 'rejected:amount-mismatch'); assert.equal(sub().payments_made, 1);
w = await deliver('invoice.paid', invoice('subscription_cycle'));
assert.equal(w.body.outcome, 'installment-2-of-12'); assert.equal(sub().status, 'active');
assert.equal(order().term_end, lib.paidThroughAfter(today, 2));

// --- Replayed invoice event is applied once ---
const replay = await deliver('invoice.paid', invoice('subscription_cycle'), 'evt_same');
const again = await deliver('invoice.paid', invoice('subscription_cycle'), 'evt_same');
assert.equal(again.body.duplicate, true); assert.equal(sub().payments_made, 3);

// --- Payments 4 to 12, then a 13th is refused ---
for (let i = 4; i <= 12; i++) assert.equal((await deliver('invoice.paid', invoice('subscription_cycle'))).body.outcome, `installment-${i}-of-12`);
assert.equal(sub().payments_made, 12);
assert.equal(order().term_end, sub().term_end, 'the 12th payment covers the full term');
w = await deliver('invoice.paid', invoice('subscription_cycle'));
assert.equal(w.body.outcome, 'rejected:payment-beyond-term-refund-needed'); assert.equal(sub().payments_made, 12);
assert.ok(sqlite.prepare("SELECT 1 FROM security_events WHERE target LIKE '%beyond-term%'").get(), 'flagged for refund');

// --- Ending: completed after 12, canceled before ---
w = await deliver('customer.subscription.deleted', {id: 'sub_1'});
assert.equal(w.body.outcome, 'subscription-completed'); assert.equal(sub().status, 'completed');
sqlite.prepare("UPDATE subscriptions SET payments_made=4,status='active'").run();
w = await deliver('customer.subscription.deleted', {id: 'sub_1'});
assert.equal(w.body.outcome, 'subscription-canceled');

console.log('Passed: monthly checkout is a subscription at the server price; checkout completion counts payment 1 and sets a 12-month end at Stripe (retried on failure); first invoice not double counted; failures mark past due without extending access; recovery, replays, payments 2-12, a refused 13th; completed versus canceled endings; paid-through dates across short months.');
