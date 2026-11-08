// Issue #20: 12-month memberships paid monthly. Exactly 12 charges, then the subscription ends by itself.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
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
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test', OWNER_EMAIL: 'owner@example.test', strongAccount: async () => ({user: {id: 'p1', email: 'pat@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          ownerIdentity: async () => ({owner: {userId: 'owner-id'}, user: {id: 'owner-id'}, headers: new Headers()}), sameOrigin: () => true, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
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

// --- Paid-through dates follow Stripe's monthly billing, including short months. Since issue #271 a payment covers
// through the next billing day itself, so a member is still on the roster on billing-day morning. ---
assert.equal(lib.paidThroughAfter('2026-11-05', 1), '2026-12-05');
assert.equal(lib.paidThroughAfter('2026-11-05', 11), '2027-10-05');
assert.equal(lib.paidThroughAfter('2027-01-31', 1), '2027-02-28', 'Jan 31 bills next on Feb 28');
assert.equal(lib.paidThroughAfter('2027-01-31', 2), '2027-03-31', 'then on Mar 31');
assert.equal(lib.membershipTerm('2026-11-05').end, '2027-11-04', 'the 12-month term still ends the day before the anniversary');
const term = load(path.resolve('lib/membership-term.ts'));
assert.equal(term.GRACE_DAYS, 7);
assert.equal(term.graceEnd('2026-12-05', '2027-11-04'), '2026-12-12', 'a failed payment keeps access for 7 days after the paid-through day');
assert.equal(term.graceEnd('2027-11-01', '2027-11-04'), '2027-11-04', 'never past the membership’s own end');

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

// --- Failed payment (issue #271): past due, a short grace on the roster, the family and the owner told once ---
const notices = kind => sqlite.prepare('SELECT * FROM notifications WHERE kind=? ORDER BY created_at').all(kind);
w = await deliver('invoice.payment_failed', invoice('subscription_cycle'), 'evt_fail_1');
assert.equal(w.body.outcome, 'installment-failed'); assert.equal(sub().status, 'past_due');
assert.equal(sub().paid_through, lib.paidThroughAfter(today, 1), 'a failed payment extends nothing');
assert.equal(order().term_end, term.graceEnd(lib.paidThroughAfter(today, 1), sub().term_end), 'the wrestler stays on the roster through the grace');
assert.equal(notices('installment_failed').length, 1); assert.equal(notices('installment_failed')[0].user_id, 'p1');
assert.match(notices('installment_failed')[0].body, /did not go through[\s\S]*Sam can still come to practice through/);
assert.equal(notices('installment_failed_owner').length, 1); assert.equal(notices('installment_failed_owner')[0].email, 'owner@example.test'); assert.equal(notices('installment_failed_owner')[0].user_id, null);
assert.match(notices('installment_failed_owner')[0].body, /1 of 12 payments made[\s\S]*Payment needs attention list/);
await deliver('invoice.payment_failed', invoice('subscription_cycle'), 'evt_fail_1');
assert.equal(notices('installment_failed').length, 1, 'a replay tells nobody again');
// Stripe's retry fails too: another notice, the same grace.
await deliver('invoice.payment_failed', invoice('subscription_cycle'), 'evt_fail_2');
assert.equal(notices('installment_failed').length, 2); assert.equal(order().term_end, term.graceEnd(lib.paidThroughAfter(today, 1), sub().term_end));
// The owner's lists: Payment needs attention on /payments, and the dashboard tile count.
const paymentsApi = load(path.resolve('app/api/payments/route.ts'));
let att = await (await paymentsApi.GET(new Request('https://a.test/api/payments?attention=1'))).json();
assert.equal(att.graceDays, 7); assert.equal(att.attention.length, 1);
assert.equal(att.attention[0].wrestler, 'Sam'); assert.equal(att.attention[0].paymentsMade, 1); assert.equal(att.attention[0].failures, 2);
assert.equal(att.attention[0].paidThrough, sub().paid_through); assert.equal(att.attention[0].rosterThrough, order().term_end);

// --- A payment for another amount (a coupon or a price edit in Stripe) counts for what Stripe collected, and the owner is told (issue #271) ---
w = await deliver('invoice.paid', invoice('subscription_cycle', 100, {id: 'in_coupon'}), 'evt_coupon');
assert.equal(w.body.outcome, 'installment-2-of-12'); assert.equal(sub().payments_made, 2); assert.equal(sub().status, 'active');
assert.equal(order().term_end, lib.paidThroughAfter(today, 2), 'access runs to the next billing day; the grace is over');
assert.deepEqual({...sqlite.prepare("SELECT order_id,invoice_id,payment_number,amount_cents,expected_cents,livemode FROM installment_payments WHERE id='evt_coupon'").get()}, {order_id: orderId, invoice_id: 'in_coupon', payment_number: 2, amount_cents: 100, expected_cents: 20000, livemode: 0});
assert.ok(sqlite.prepare("SELECT 1 FROM security_events WHERE action='installment_amount_mismatch' AND target=?").get(`${orderId} 2 100 20000`), 'flagged for the owner');
assert.equal(notices('installment_mismatch_owner').length, 1); assert.match(notices('installment_mismatch_owner')[0].subject, /Sam paid \$1\.00, not \$200\.00/);
assert.equal(notices('installment_mismatch_owner')[0].body.includes('in_coupon'), true);
att = await (await paymentsApi.GET(new Request('https://a.test/api/payments?attention=1'))).json();
assert.equal(att.attention.length, 0, 'paid up again');
// The books read the amount Stripe collected.
const books = load(path.resolve('lib/financials.ts'));
const lines = await books.ledgerLines(today, today);
assert.equal(lines.find(l => l.id === 'installment:evt_coupon').amountCents, 100);
assert.equal(lines.find(l => l.id === 'payment:' + orderId).amountCents, 20000);
w = await deliver('invoice.paid', invoice('subscription_cycle'));
assert.equal(w.body.outcome, 'installment-3-of-12'); assert.equal(sub().status, 'active');
assert.equal(order().term_end, lib.paidThroughAfter(today, 3));
assert.equal(sqlite.prepare("SELECT count(*) n FROM security_events WHERE action='installment_amount_mismatch'").get().n, 1, 'the usual amount is not flagged');
assert.equal(lines.length + 1, (await books.ledgerLines(today, today)).length);

// --- Replayed invoice event is applied once ---
const replay = await deliver('invoice.paid', invoice('subscription_cycle'), 'evt_same');
const again = await deliver('invoice.paid', invoice('subscription_cycle'), 'evt_same');
assert.equal(again.body.duplicate, true); assert.equal(sub().payments_made, 4);
assert.equal(sqlite.prepare("SELECT count(*) n FROM installment_payments WHERE id='evt_same'").get().n, 1);

// --- Payments 5 to 12, then a 13th is refused ---
for (let i = 5; i <= 12; i++) assert.equal((await deliver('invoice.paid', invoice('subscription_cycle'))).body.outcome, `installment-${i}-of-12`);
assert.equal(sub().payments_made, 12);
assert.equal(order().term_end, sub().term_end, 'the 12th payment covers the full term');
w = await deliver('invoice.paid', invoice('subscription_cycle'));
assert.equal(w.body.outcome, 'rejected:payment-beyond-term-refund-needed'); assert.equal(sub().payments_made, 12);
assert.ok(sqlite.prepare("SELECT 1 FROM security_events WHERE target LIKE '%beyond-term%'").get(), 'flagged for refund');
assert.equal(sqlite.prepare("SELECT count(*) n FROM installment_payments").get().n, 11, 'payments 2 to 12, one row each');

// --- Ending: completed after 12, canceled before ---
w = await deliver('customer.subscription.deleted', {id: 'sub_1'});
assert.equal(w.body.outcome, 'subscription-completed'); assert.equal(sub().status, 'completed');
assert.equal(notices('subscription_canceled').length, 0, 'a plan that ran its course is not "canceled"');
// Canceled during a grace (issue #271): access ends on the paid-through day, and the family and the owner are told.
sqlite.prepare("UPDATE subscriptions SET payments_made=4,status='past_due',paid_through=? WHERE order_id=?").run(lib.paidThroughAfter(today, 4), orderId);
sqlite.prepare('UPDATE orders SET term_end=? WHERE id=?').run(term.graceEnd(lib.paidThroughAfter(today, 4), sub().term_end), orderId);
w = await deliver('customer.subscription.deleted', {id: 'sub_1'}, 'evt_canceled');
assert.equal(w.body.outcome, 'subscription-canceled'); assert.equal(sub().status, 'canceled');
assert.equal(order().term_end, lib.paidThroughAfter(today, 4), 'the grace ends with the plan');
assert.equal(notices('subscription_canceled').length, 1); assert.match(notices('subscription_canceled')[0].body, /stopped after 4 of 12/);
assert.equal(notices('subscription_canceled_owner').length, 1);
att = await (await paymentsApi.GET(new Request('https://a.test/api/payments?attention=1'))).json();
assert.equal(att.attention.length, 0, 'a canceled plan is not waiting for a payment');

// --- Payment attempts (issue #271): the monthly checkout and Stripe's last word about it ---
const attempts = await (await paymentsApi.GET(new Request('https://a.test/api/payments?attempts=1'))).json();
assert.equal(attempts.attempts.length, 1); const a = attempts.attempts[0];
assert.equal(a.id, orderId); assert.equal(a.sessionId, order().stripe_session_id); assert.equal(a.wrestler, 'Sam'); assert.equal(a.parent, 'Pat');
assert.equal(a.outcome, 'subscription-canceled'); assert.equal(a.words, 'The monthly plan was canceled before 12 payments.'); assert.equal(a.state, 'paid');
assert.equal((await (await paymentsApi.GET(new Request('https://a.test/api/payments?attempts=1&q=nobody'))).json()).attempts.length, 0);
assert.equal((await (await paymentsApi.GET(new Request('https://a.test/api/payments?attempts=1&q=PAT@example'))).json()).attempts.length, 1, 'found by the family email');

console.log('Passed: monthly checkout is a subscription at the server price; checkout completion counts payment 1 and sets a 12-month end at Stripe (retried on failure); first invoice not double counted; a failed payment marks past due, keeps a 7-day grace and tells the family and the owner once per failure; a payment for another amount counts for what Stripe collected and is flagged; recovery, replays, payments 2-12, a refused 13th; completed versus canceled endings, canceling ends the grace; paid-through dates on the billing day across short months; the attention and attempts lists.');
