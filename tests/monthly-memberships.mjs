// Monthly memberships (issue #20), month to month since Nov 13, 2026 (#2, issue #314): Stripe charges every month until
// the membership is canceled. The family cancels online (no more charges, access to the end of the paid month); a card
// Stripe gives up on pauses the membership (#313), and a restart is a new sign-up from that day with no back pay.
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
const stripe = {sessions: [], updates: [], cancels: [], retrieves: 0, fail: false, n: 0};
function StripeMock() {
  return {
    checkout: {sessions: {create: async params => { const s = {id: 'cs_test_m' + ++stripe.n, url: 'https://checkout.stripe.test/m', livemode: false, params}; stripe.sessions.push(s); return s; }, expire: async () => ({})}},
    subscriptions: {
      retrieve: async id => { stripe.retrieves++; return {id, metadata: {}}; },
      update: async (id, params, opts) => { if (stripe.fail) throw new Error('Stripe down'); stripe.updates.push({id, params, opts}); return {id}; },
      cancel: async (id, params, opts) => { if (stripe.fail) throw new Error('Stripe down'); stripe.cancels.push({id, params, opts}); return {id, status: 'canceled'}; }
    }
  };
}
StripeMock.createFetchHttpClient = () => ({});
// Who is signed in, and whether the request came from the site itself.
let actor = {id: 'p1', email: 'pat@example.test'}, origin = true;
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText,
    {module, exports: module.exports, crypto, TextEncoder, TextDecoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, Promise, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name === 'stripe') return StripeMock;
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test', OWNER_EMAIL: 'owner@example.test',
          strongAccount: async () => ({user: {id: actor.id, email: actor.email, email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          ownerIdentity: async () => ({owner: {userId: 'owner-id'}, user: {id: 'owner-id'}, headers: new Headers()}), sameOrigin: () => origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
const vault = load(path.resolve('lib/stripe-test.ts'));
const lib = load(path.resolve('lib/stripe-webhook.ts'));
const term = load(path.resolve('lib/membership-term.ts'));
const checkout = load(path.resolve('app/api/checkout/route.ts'));
const webhook = load(path.resolve('app/api/stripe-webhook/route.ts'));
const memberships = load(path.resolve('app/api/memberships/route.ts'));
const paymentsApi = load(path.resolve('app/api/payments/route.ts'));
const ordersApi = load(path.resolve('app/api/orders/route.ts'));

// --- Paid-through dates follow Stripe's monthly billing, including short months, with no 12-payment cap. A payment
// covers through the next billing day itself (issue #271), so a member is still on the roster on billing-day morning. ---
assert.equal(lib.paidThroughAfter('2026-11-05', 1), '2026-12-05');
assert.equal(lib.paidThroughAfter('2026-11-05', 11), '2027-10-05');
assert.equal(lib.paidThroughAfter('2026-11-05', 12), '2027-11-05', 'a 12th payment covers a month like any other');
assert.equal(lib.paidThroughAfter('2026-11-05', 30), '2029-05-05', 'and so does a 30th');
assert.equal(lib.paidThroughAfter('2027-01-31', 1), '2027-02-28', 'Jan 31 bills next on Feb 28');
assert.equal(lib.paidThroughAfter('2027-01-31', 2), '2027-03-31', 'then on Mar 31');
assert.equal(term.GRACE_DAYS, 7);
assert.equal(term.graceEnd('2026-12-05'), '2026-12-12', 'a failed payment keeps access for 7 days after the paid-through day');
assert.equal(term.graceEnd('2026-12-05', null), '2026-12-12', 'a month-to-month membership has no end to cap it');
assert.equal(term.graceEnd('2027-11-01', '2027-11-04'), '2027-11-04', 'a membership from the 12-month plan never ran past its end');

// --- Setup ---
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const longDay = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'});
const nth = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
sqlite.prepare('INSERT INTO academy_state VALUES (?,?,?,?,?)').run('academy', JSON.stringify({programNamingVersion: 2, programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000}], seasons: []}), 1, 'o', today);
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('p1', 'pat@example.test', JSON.stringify({parentName: 'Pat', phone: '', wrestlers: [
  {id: 'w1', name: 'Sam', grade: '8', usawNumber: 'TEST-1234', usawExpires: '2099-12-31'}, {id: 'w2', name: 'Jo', grade: '9', usawNumber: 'TEST-5678', usawExpires: '2099-12-31'}]}), 1, today);
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('p2', 'other@example.test', JSON.stringify({parentName: 'Other', phone: '', wrestlers: []}), 1, today);
sqlite.prepare("INSERT INTO integration_secrets VALUES ('stripe-test',?,?,?)").run(await vault.sealStripeKey('rk_test_' + 'm'.repeat(24)), 'o', today);
const startCheckout = async (wrestlerId, extra = {}) => {
  const r = await checkout.POST(new Request('https://a.test/api/checkout', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://a.test'},
    body: JSON.stringify({source: 'membership', program: 'Intermediate', plan: 'monthly', wrestlerId, acceptTerms: true, amountCents: 1, ...extra})}));
  return {status: r.status, body: await r.json()};
};

// --- Checkout creates a monthly subscription for the server price, with nothing that ends it ---
const refused = await startCheckout('w1', {acceptTerms: false});
assert.equal(refused.status, 400, 'no payment without ticking the consent box');
const first = await startCheckout('w1');
assert.equal(first.status, 200);
const orderId = first.body.orderId;
const params = stripe.sessions[0].params;
assert.equal(params.mode, 'subscription');
assert.deepEqual(JSON.parse(JSON.stringify(params.line_items[0].price_data)), {currency: 'usd', unit_amount: 20000, recurring: {interval: 'month'}, product_data: {name: 'SWA Intermediate: monthly membership', description: 'For Sam'}});
assert.equal(params.subscription_data.metadata.order_id, orderId);
assert.equal(params.subscription_data.description, 'SWA Intermediate: monthly membership, renews every month until canceled');
assert.equal(params.subscription_data.cancel_at, undefined); assert.equal(params.payment_intent_data, undefined, 'not allowed in subscription mode');
assert.doesNotMatch(JSON.stringify(params), /12/, 'no 12-month term anywhere in the checkout');

// --- Webhook helpers ---
const sign = raw => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')}`; };
let ev = 0;
const deliver = async (type, object, id = 'evt_m' + ++ev) => {
  const raw = JSON.stringify({id, type, livemode: false, data: {object}});
  const r = await webhook.POST(new Request('https://a.test/api/stripe-webhook', {method: 'POST', headers: {'stripe-signature': sign(raw)}, body: raw}));
  return {status: r.status, body: await r.json(), id};
};
const order = (id = orderId) => sqlite.prepare('SELECT * FROM orders WHERE id=?').get(id);
const sub = (id = orderId) => sqlite.prepare('SELECT * FROM subscriptions WHERE order_id=?').get(id);
const completed = (id, subscription) => ({id: order(id).stripe_session_id, mode: 'subscription', client_reference_id: id, metadata: {order_id: id}, amount_total: 20000, currency: 'usd', livemode: false, payment_status: 'paid', subscription});
const invoice = (reason, amount = 20000, extra = {}, subscription = 'sub_1') => ({id: 'in_' + ++ev, billing_reason: reason, amount_paid: amount, parent: {subscription_details: {subscription}}, ...extra});
const notices = kind => sqlite.prepare('SELECT * FROM notifications WHERE kind=? ORDER BY created_at').all(kind);

// --- A later invoice arriving before checkout completion is retried, not lost ---
let w = await deliver('invoice.paid', invoice('subscription_cycle'));
assert.equal(w.status, 500, 'Stripe retries an invoice for a subscription not recorded yet');
assert.equal(sqlite.prepare("SELECT count(*) n FROM stripe_events WHERE type='invoice.paid'").get().n, 0);

// --- Checkout completes: the first payment, month to month, nothing set at Stripe ---
w = await deliver('checkout.session.completed', completed(orderId, 'sub_1'), 'evt_complete');
assert.equal(w.status, 200); assert.equal(w.body.outcome, 'paid');
assert.equal(order().status, 'paid'); assert.equal(order().term_start, today);
assert.equal(order().term_end, lib.paidThroughAfter(today, 1), 'access runs through the next billing day');
assert.deepEqual({...sub()}, {...sub(), payments_made: 1, payments_total: null, term_start: today, term_end: null, paid_through: lib.paidThroughAfter(today, 1), cancel_at: null, status: 'active'});
assert.equal(stripe.updates.length + stripe.retrieves, 0, 'no end date is set at Stripe: the subscription renews until canceled');

// --- The acknowledgment (NY GBL §527-a): the terms, the amount, how often, the deadline and how to cancel, once ---
let ack = notices('membership_started');
assert.equal(ack.length, 1); assert.equal(ack[0].user_id, 'p1'); assert.equal(ack[0].email, 'pat@example.test');
assert.equal(ack[0].subject, 'Your monthly membership for Sam: please keep this email');
const ackBody = ack[0].body;
for (const words of [
  `This confirms Sam’s SWA Intermediate membership at Savage Wrestling Academy, which started on ${longDay(today)}. Please keep this email for your records.`,
  'What it includes: every regular scheduled practice in SWA Intermediate.',
  `Price: $200.00 a month. Your first payment of $200.00 was charged on ${longDay(today)}.`,
  `the membership is month to month, with no contract and no end date. It renews automatically and charges $200.00 to the same card every month on the ${nth(Number(today.slice(8)))} of each month`,
  `Your next payment is on ${longDay(lib.paidThroughAfter(today, 1))}.`,
  'How to cancel: any time, online in your family account (https://swa.test/family#memberships, then Cancel membership), or by email to savagewrestlingclub@gmail.com, by phone, or in person at the academy, 20 Railroad St, Huntington Station, NY 11746.',
  `To stop the next payment, cancel before ${longDay(lib.paidThroughAfter(today, 1))}`,
  'When you cancel, no more payments are taken and Sam can keep training through the end of the month already paid for. There is no partial refund and no fee for canceling.',
  'the membership pauses: nothing more is charged', 'missed months are not charged', 'https://swa.test/membership-terms'
]) assert.ok(ackBody.includes(words), 'acknowledgment says: ' + words);
assert.doesNotMatch(ackBody, /12-month|12 monthly|commitment/);
assert.equal((await deliver('checkout.session.completed', completed(orderId, 'sub_1'), 'evt_complete')).body.duplicate, true);
assert.equal((await deliver('checkout.session.async_payment_succeeded', completed(orderId, 'sub_1'))).body.outcome, 'ignored:already-paid');
assert.equal(notices('membership_started').length, 1, 'sent once per membership, whatever Stripe sends again');

// --- The first invoice is not counted twice ---
w = await deliver('invoice.paid', invoice('subscription_create'));
assert.equal(w.body.outcome, 'ignored:first-payment-counted-at-checkout'); assert.equal(sub().payments_made, 1);

// --- Failed payment (issue #271): past due, a 7-day grace on the roster, the family and the owner told once ---
w = await deliver('invoice.payment_failed', invoice('subscription_cycle'), 'evt_fail_1');
assert.equal(w.body.outcome, 'installment-failed'); assert.equal(sub().status, 'past_due');
assert.equal(sub().paid_through, lib.paidThroughAfter(today, 1), 'a failed payment extends nothing');
assert.equal(order().term_end, term.graceEnd(lib.paidThroughAfter(today, 1)), 'the wrestler stays on the roster through the grace');
assert.equal(notices('installment_failed').length, 1); assert.match(notices('installment_failed')[0].body, /did not go through[\s\S]*Sam can still come to practice through[\s\S]*the membership pauses and nothing more is charged/);
assert.match(notices('installment_failed_owner')[0].body, /1 monthly payment made[\s\S]*Payment needs attention list/);
await deliver('invoice.payment_failed', invoice('subscription_cycle'), 'evt_fail_1');
assert.equal(notices('installment_failed').length, 1, 'a replay tells nobody again');
await deliver('invoice.payment_failed', invoice('subscription_cycle'), 'evt_fail_2');
assert.equal(notices('installment_failed').length, 2, 'each retry Stripe reports gets one notice');
let att = await (await paymentsApi.GET(new Request('https://a.test/api/payments?attention=1'))).json();
assert.equal(att.graceDays, 7); assert.equal(att.attention.length, 1); assert.equal(att.attention[0].paymentsMade, 1); assert.equal(att.attention[0].paymentsTotal, null); assert.equal(att.attention[0].failures, 2);

// --- A payment for another amount counts for what Stripe collected, and the owner is told ---
w = await deliver('invoice.paid', invoice('subscription_cycle', 100, {id: 'in_coupon'}), 'evt_coupon');
assert.equal(w.body.outcome, 'installment-2'); assert.equal(sub().payments_made, 2); assert.equal(sub().status, 'active');
assert.equal(order().term_end, lib.paidThroughAfter(today, 2), 'access runs to the next billing day; the grace is over');
assert.ok(sqlite.prepare("SELECT 1 FROM security_events WHERE action='installment_amount_mismatch' AND target=?").get(`${orderId} 2 100 20000`));
assert.match(notices('installment_mismatch_owner')[0].body, /monthly payment 2 on Sam's/);
att = await (await paymentsApi.GET(new Request('https://a.test/api/payments?attention=1'))).json();
assert.equal(att.attention.length, 0, 'paid up again');
const books = load(path.resolve('lib/financials.ts'));
assert.equal((await books.ledgerLines(today, today)).find(l => l.id === 'installment:evt_coupon').description, 'SWA Intermediate: monthly membership (payment 2) · Sam');

// --- Month to month: payments go on past the 12th, and a replay is applied once ---
for (let i = 3; i <= 14; i++) assert.equal((await deliver('invoice.paid', invoice('subscription_cycle'))).body.outcome, `installment-${i}`);
assert.equal((await deliver('invoice.paid', invoice('subscription_cycle'), 'evt_same')).body.outcome, 'installment-15');
assert.equal((await deliver('invoice.paid', invoice('subscription_cycle'), 'evt_same')).body.duplicate, true);
assert.equal(sub().payments_made, 15); assert.equal(sub().payments_total, null); assert.equal(sub().status, 'active');
assert.equal(sub().paid_through, lib.paidThroughAfter(today, 15)); assert.equal(order().term_end, lib.paidThroughAfter(today, 15), 'paid through more than a year ahead');
assert.equal(sqlite.prepare("SELECT count(*) n FROM installment_payments WHERE order_id=?").get(orderId).n, 14, 'payments 2 to 15, one row each');
assert.equal(sqlite.prepare("SELECT count(*) n FROM security_events WHERE target LIKE '%beyond-term%'").get().n, 0, 'nothing is refused after 12');
const paidThrough = sub().paid_through;

// --- The family cancels online (issue #314): the route checks it is their own membership ---
const cancel = async (orderId, body = {}) => { const r = await memberships.POST(new Request('https://a.test/api/memberships', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action: 'cancel', orderId, ...body})})); return {status: r.status, body: await r.json()}; };
actor = {id: 'p2', email: 'other@example.test'};
let c = await cancel(orderId);
assert.equal(c.status, 404, 'another family’s membership reads as not found'); assert.equal(c.body.error, 'Membership not found.');
actor = {id: 'p1', email: 'pat@example.test'}; origin = false;
assert.equal((await cancel(orderId)).status, 403, 'only from the site itself'); origin = true;
assert.equal((await cancel('not-an-order')).status, 400);
assert.equal(stripe.updates.length + stripe.cancels.length, 0, 'none of those reached Stripe');
stripe.fail = true;
c = await cancel(orderId);
assert.equal(c.status, 502); assert.equal(sub().cancel_at, null, 'Stripe down: nothing changed, the family can try again'); stripe.fail = false;
c = await cancel(orderId);
assert.equal(c.status, 200); assert.equal(c.body.endsOn, paidThrough); assert.equal(c.body.wrestler, 'Sam');
assert.deepEqual(JSON.parse(JSON.stringify(stripe.updates.at(-1))), {id: 'sub_1', params: {cancel_at_period_end: true, cancellation_details: {comment: 'Canceled by the family on the website'}, metadata: {canceled_by: 'family'}}, opts: {idempotencyKey: 'cancel-' + orderId}});
assert.equal(sub().cancel_at, paidThrough); assert.equal(sub().status, 'active', 'still a member until the paid month ends');
assert.equal(order().term_end, paidThrough, 'no access is taken away: the paid month stands, with no partial refund');
assert.ok(sqlite.prepare("SELECT 1 FROM security_events WHERE action='membership_canceled' AND actor='p1' AND target=?").get(orderId + ' family'));
const canceledNote = notices('membership_canceled');
assert.equal(canceledNote.length, 1); assert.equal(canceledNote[0].user_id, 'p1'); assert.equal(canceledNote[0].subject, 'Sam\'s membership is canceled');
assert.equal(canceledNote[0].body, `You canceled Sam's SWA Intermediate: monthly membership. No more charges. Sam can keep practicing through ${longDay(paidThrough)}. To train again later, sign up from your family account.`);
assert.doesNotMatch(canceledNote[0].body, /refund/, 'the cancellation confirmation leaves refunds to the terms');
assert.equal(notices('membership_canceled_owner').length, 1);
const view = await (await ordersApi.GET(new Request('https://a.test/api/orders?order=' + orderId))).json();
assert.equal(view.order.cancel_on, paidThrough, 'the family page reads the last day');
c = await cancel(orderId);
assert.equal(c.status, 409, 'canceling twice changes nothing'); assert.equal(stripe.updates.length, 1);
// Stripe ends it on the billing day: canceled, not paused, with access to the paid-through day.
w = await deliver('customer.subscription.deleted', {id: 'sub_1', status: 'canceled', cancellation_details: {reason: 'cancellation_requested'}}, 'evt_end_1');
assert.equal(w.body.outcome, 'subscription-canceled'); assert.equal(sub().status, 'canceled'); assert.equal(order().term_end, paidThrough);
assert.equal(notices('subscription_canceled').length, 1); assert.match(notices('subscription_canceled')[0].body, /was canceled, so no more payments are taken\. The last day of the membership is/);
assert.equal(notices('membership_paused').length, 0);
let attempts = await (await paymentsApi.GET(new Request('https://a.test/api/payments?attempts=1&q=Sam'))).json();
assert.equal(attempts.attempts[0].words, 'The membership was canceled; no more monthly payments.');
assert.equal((await deliver('customer.subscription.deleted', {id: 'sub_1', cancellation_details: {reason: 'payment_failed'}})).body.outcome, 'ignored:subscription-canceled', 'a later ending changes nothing');
assert.equal((await cancel(orderId)).status, 409);

// --- Pause (#313): Stripe gives up on Jo's card; the membership pauses instead of ending ---
const jo = await startCheckout('w2');
const joOrder = jo.body.orderId;
await deliver('checkout.session.completed', completed(joOrder, 'sub_2'));
assert.equal(notices('membership_started').length, 2, 'Jo’s membership gets its own acknowledgment');
const joPaid = sub(joOrder).paid_through;
await deliver('invoice.payment_failed', invoice('subscription_cycle', 20000, {}, 'sub_2'));
assert.equal(order(joOrder).term_end, term.graceEnd(joPaid));
// Stripe's retries fail too and it gives up: cancellation_details.reason is 'payment_failed'.
w = await deliver('customer.subscription.deleted', {id: 'sub_2', status: 'canceled', cancellation_details: {reason: 'payment_failed'}}, 'evt_pause');
assert.equal(w.body.outcome, 'subscription-paused'); assert.equal(sub(joOrder).status, 'paused');
assert.equal(order(joOrder).term_end, joPaid, 'off the roster after the paid-through day: the grace stops');
assert.equal(notices('membership_paused').length, 1); assert.equal(notices('membership_paused')[0].user_id, 'p1');
assert.match(notices('membership_paused')[0].body, /so the membership is paused\. Nothing more will be charged\.[\s\S]*Restart membership in your family account[\s\S]*the missed months are not charged/);
assert.equal(notices('membership_paused_owner').length, 1); assert.match(notices('membership_paused_owner')[0].body, /Stripe stopped retrying the card for Jo's/);
assert.equal(notices('subscription_canceled').length, 1, 'a pause is not a cancellation');
attempts = await (await paymentsApi.GET(new Request('https://a.test/api/payments?attempts=1&q=Jo'))).json();
assert.match(attempts.attempts[0].words, /paused/);
assert.equal((await deliver('customer.subscription.deleted', {id: 'sub_2', cancellation_details: {reason: 'payment_failed'}}, 'evt_pause')).body.duplicate, true);
assert.equal((await deliver('invoice.payment_failed', invoice('subscription_cycle', 20000, {}, 'sub_2'))).body.outcome, 'ignored:subscription-paused', 'a late failure after the pause changes nothing');
assert.equal(order(joOrder).term_end, joPaid);
assert.equal(notices('membership_paused').length, 1, 'told once');
assert.equal((await cancel(joOrder)).status, 409, 'nothing to cancel: a paused membership charges nothing');
att = await (await paymentsApi.GET(new Request('https://a.test/api/payments?attention=1'))).json();
assert.equal(att.attention.length, 0, 'a paused membership is not waiting for a payment');
// Without a reason from Stripe, a past-due membership nobody asked to cancel is a pause too; one the family canceled is not.
const end = sqlite.prepare("UPDATE subscriptions SET status='past_due',cancel_at=? WHERE order_id=?");
end.run(null, joOrder);
assert.equal((await deliver('customer.subscription.deleted', {id: 'sub_2'})).body.outcome, 'subscription-paused');
end.run(joPaid, joOrder);
assert.equal((await deliver('customer.subscription.deleted', {id: 'sub_2'})).body.outcome, 'subscription-canceled');
sqlite.prepare("UPDATE subscriptions SET status='paused',cancel_at=NULL WHERE order_id=?").run(joOrder);

// --- Restart after a pause: a new monthly sign-up from today, at the program's price, with no back pay ---
// A real pause comes a month or more after sign-up, so the paused order is from an earlier day.
sqlite.prepare('UPDATE orders SET dedupe_key=? WHERE id=?').run(`p1|w2|monthly|Intermediate|2026-01-01`, joOrder);
const registration = load(path.resolve('app/api/registration/route.ts'));
const reviewed = await (await registration.POST(new Request('https://a.test/api/registration', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://a.test'},
  body: JSON.stringify({wrestlerId: 'w2', program: 'Intermediate', plan: 'monthly'})}))).json();
assert.equal(reviewed.review.restart, true, 'the review says it restarts the paused membership');
assert.equal(reviewed.review.cents, 20000, 'one month at the price, nothing for the missed months');
const restart = await startCheckout('w2');
assert.equal(restart.status, 200, 'a paused membership never blocks its own restart, even inside its last paid month');
assert.equal(stripe.sessions.at(-1).params.line_items[0].price_data.unit_amount, 20000, 'charged the monthly price, no back pay');
await deliver('checkout.session.completed', completed(restart.body.orderId, 'sub_3'));
assert.equal(sub(restart.body.orderId).status, 'active'); assert.equal(sub(restart.body.orderId).payments_made, 1); assert.equal(order(restart.body.orderId).term_start, today, 'billed from today');
assert.equal(sub(joOrder).status, 'paused', 'the old membership stays as it was');
assert.equal((await startCheckout('w2')).status, 409, 'once restarted, a second sign-up is refused as usual');

// --- The owner cancels for a family from Payments; a past-due membership is canceled at Stripe at once ---
sqlite.prepare("UPDATE subscriptions SET status='past_due' WHERE order_id=?").run(restart.body.orderId);
const owner = await paymentsApi.POST(new Request('https://a.test/api/payments', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action: 'membership-cancel', orderId: restart.body.orderId})}));
assert.equal(owner.status, 200);
assert.deepEqual(JSON.parse(JSON.stringify(stripe.cancels.at(-1))), {id: 'sub_3', params: {cancellation_details: {comment: 'Canceled by the academy on the website'}}, opts: {idempotencyKey: 'cancel-now-' + restart.body.orderId}});
assert.match(notices('membership_canceled').at(-1).body, /^The academy canceled Jo's/);
assert.equal(notices('membership_canceled_owner').length, 1, 'the owner is not emailed about their own action');
assert.ok(sqlite.prepare("SELECT 1 FROM security_events WHERE action='membership_canceled' AND actor='owner-id' AND target=?").get(restart.body.orderId + ' owner'));
const list = await (await paymentsApi.GET(new Request('https://a.test/api/payments'))).json();
assert.deepEqual(JSON.parse(JSON.stringify(list.payments.find(p => p.id === restart.body.orderId).membership)), {status: 'past_due', cancelOn: sub(restart.body.orderId).paid_through});

// --- A membership from the earlier 12-month plan still reads, counts and ends as before ---
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end)
  VALUES ('legacy','p1','pat@example.test','w1','Sam','monthly','Intermediate','Intermediate','SWA Intermediate: 12-month membership, monthly payment','[]',20000,0,20000,'usd','{}','{}','paid','legacy',0,'t','t','t','2026-01-05','2026-11-05')`).run();
sqlite.prepare("INSERT INTO subscriptions VALUES ('legacy','sub_old','active',10,12,'2026-01-05','2027-01-04','2026-11-05','2027-01-05T15:00:00.000Z','t')").run();
assert.equal((await deliver('invoice.paid', invoice('subscription_cycle', 20000, {}, 'sub_old'))).body.outcome, 'installment-11');
assert.equal(sub('legacy').paid_through, '2026-12-05'); assert.equal(sub('legacy').payments_total, 12);
assert.equal((await deliver('invoice.paid', invoice('subscription_cycle', 20000, {}, 'sub_old'))).body.outcome, 'installment-12');
assert.equal((await deliver('customer.subscription.deleted', {id: 'sub_old'})).body.outcome, 'subscription-completed');
const outcomes = load(path.resolve('lib/stripe-outcomes.ts'));
assert.equal(outcomes.outcomeWords('installment-3-of-12', 'paid'), 'Monthly payment 3 received.', 'older outcomes still read');

console.log('Passed: monthly checkout is a month-to-month subscription at the server price with no end set at Stripe; the acknowledgment email (terms, amount, monthly, next billing day, how to cancel) is sent once; failed payments keep a 7-day grace and tell the family and the owner once each; payments go on past 12; the family cancels its own membership online (another family\'s is not found), Stripe stops at the end of the paid month and access stays to the paid-through day; Stripe giving up pauses the membership, told once and safe against late or repeated events; a restart is a new monthly sign-up from today with no back pay; the owner cancels for a family; 12-month-plan rows still read and end.');
