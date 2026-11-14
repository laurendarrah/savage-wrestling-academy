// Issue #42: partial refunds and Stripe card fees. Refunds come only from the verified webhook and are stored as Stripe's
// running total per payment, so replayed and out-of-order events give the same books. Fees are read from Stripe after
// the payment (lib/stripe-fees.ts), never while marking it paid, and a fee lookup that fails changes nothing else.
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

// A stand-in Stripe API. Every call is logged with the mode of the key that made it.
const stripeCalls = [];
const keys = {test: 'rk_test_unit', live: 'rk_live_unit'};
let intents = {}, invoices = {}, invoicePayments = {}, failIntent = new Set(), refuseKey = false;
const client = mode => ({
  subscriptions: {retrieve: async id => { stripeCalls.push([mode, 'subscriptions.retrieve', id]); return {id, billing_cycle_anchor: Math.floor(Date.now() / 1000), metadata: {}}; },
    update: async id => { stripeCalls.push([mode, 'subscriptions.update', id]); return {id}; }},
  paymentIntents: {retrieve: async (id, params) => {
    stripeCalls.push([mode, 'paymentIntents.retrieve', id, params]);
    if (refuseKey) throw Object.assign(Error('The provided key does not have the required permissions'), {type: 'StripePermissionError', statusCode: 403});
    if (failIntent.has(id)) throw Object.assign(Error('Stripe is having a moment'), {type: 'StripeAPIError', statusCode: 500});
    if (!intents[id]) throw Object.assign(Error('No such payment_intent'), {type: 'StripeInvalidRequestError', statusCode: 404});
    return intents[id];
  }},
  invoices: {list: async params => { stripeCalls.push([mode, 'invoices.list', params]); return {data: invoices[params.subscription] ?? []}; }},
  invoicePayments: {list: async params => {
    stripeCalls.push([mode, 'invoicePayments.list', params]);
    if (params.invoice) return {data: invoicePayments[params.invoice] ?? []};
    const pi = params.payment?.payment_intent, hit = Object.entries(invoicePayments).find(([, list]) => list.some(p => p.payment.payment_intent === pi));
    if (pi === 'pi_stripe_down') throw Object.assign(Error('Stripe is having a moment'), {type: 'StripeAPIError', statusCode: 500});
    return {data: hit ? hit[1].filter(p => p.payment.payment_intent === pi).map(p => ({...p, invoice: Object.values(invoices).flat().find(i => i.id === hit[0])})) : []};
  }},
});
const mode = () => env.STRIPE_MODE === 'live' ? 'live' : 'test';
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, TextEncoder, Uint8Array, Intl, Date, URL, URLSearchParams, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, RegExp, Error, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: {userId: 'owner-id'}, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.endsWith('/stripe-test')) return {stripeMode: mode, storedStripeKeyFor: async m => keys[m] ?? null,
          stripeClientFor: (m, key) => { assert.equal(key, keys[m], 'each mode uses its own key'); return client(m); }};
        if (name.endsWith('/notify')) return {noticeLessonBooked: async () => {}, noticePaymentRecorded: async () => {}, quietly: async f => { try { await f(); } catch {} }};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
const webhook = load(path.resolve('lib/stripe-webhook.ts'));
const fees = load(path.resolve('lib/stripe-fees.ts'));
const books = load(path.resolve('lib/financials.ts'));
const payments = load(path.resolve('lib/offline-payments.ts'));
const refunds = load(path.resolve('lib/card-refunds.ts'));
const financialsApi = load(path.resolve('app/api/financials/route.ts'));

const nyDay = d => d.toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = nyDay(new Date()), month = today.slice(0, 7);
const T = Math.floor(Date.now() / 1000) - 3600;            // Stripe event times, in seconds
const order = (id, kind, cents, extra = {}) => {
  const o = {livemode: 0, label: kind === 'monthly' ? 'SWA Intermediate monthly membership' : 'Walk-in practice', ...extra};
  sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,source)
    VALUES (?,?,?,?,?,?,'Intermediate',?,?,'[]',?,0,?,'usd','{}','{}','pending',?,?,'t','t','stripe')`).run(id, 'u-' + id, id + '@example.test', 'w-' + id, 'Sam ' + id, kind, 'item-' + id, o.label, cents, cents, 'k-' + id, o.livemode);
};
const event = (id, type, object, extra = {}) => webhook.applyStripeEvent({id, type, livemode: false, created: T, data: {object}, ...extra});
const pay = (orderId, cents, extra = {}) => event('evt_pay_' + orderId, 'checkout.session.completed', {id: 'cs_' + orderId, client_reference_id: orderId, livemode: false, payment_status: 'paid', amount_total: cents, currency: 'usd', ...extra});
const refund = (id, intent, cumulative, created, extra = {}) => event(id, 'charge.refunded', {object: 'charge', id: 'ch_' + intent, payment_intent: intent, amount: extra.amount ?? 4000, amount_refunded: cumulative, refunded: cumulative === (extra.amount ?? 4000), livemode: Boolean(extra.livemode)},
  {created, livemode: Boolean(extra.livemode)});
const status = id => sqlite.prepare('SELECT status FROM orders WHERE id=?').get(id).status;
const rows = (sql, ...a) => sqlite.prepare(sql).all(...a).map(r => ({...r}));
const plain = v => JSON.parse(JSON.stringify(v));   // values made inside the sandbox, compared as plain data
const stepsFor = intent => plain(refunds.refundSteps(rows('SELECT * FROM payment_refunds WHERE payment_intent=?', intent)).map(s => [s.changeCents, s.refunded_at]));
const iso = s => new Date(s * 1000).toISOString();

// ---------- Refunds: partial, replayed, out of order, then full ----------
order('walk', 'walkin', 4000);
assert.equal((await pay('walk', 4000, {payment_intent: 'pi_walk'})).outcome, 'paid');
assert.equal(stripeCalls.length, 0, 'marking a one-time payment paid never calls Stripe, so a fee lookup cannot slow or block it');

let r = await refund('evt_r1', 'pi_walk', 1000, T + 100);
assert.equal(r.outcome, 'partial-refund'); assert.equal(status('walk'), 'paid', 'a partial refund keeps the payment and the place');
assert.equal((await refund('evt_r1', 'pi_walk', 1000, T + 100)).duplicate, true, 'a replayed event is ignored');
assert.equal(rows('SELECT * FROM payment_refunds').length, 1, 'stored once');
// Stripe sends the full refund (total $40) before the second partial (total $25).
assert.equal((await refund('evt_r3', 'pi_walk', 4000, T + 300)).outcome, 'refunded');
assert.equal(status('walk'), 'refunded', 'refunded in full: off the roster');
assert.equal((await refund('evt_r2', 'pi_walk', 2500, T + 200)).outcome, 'partial-refund');
assert.equal(status('walk'), 'refunded', 'a late partial event never un-refunds');
assert.deepEqual(stepsFor('pi_walk'), [[1000, iso(T + 100)], [1500, iso(T + 200)], [1500, iso(T + 300)]], 'each refund is the change in Stripe\'s total, in Stripe\'s order');

// The same events in Stripe's order give exactly the same refunds.
order('walk2', 'walkin', 4000);
await pay('walk2', 4000, {payment_intent: 'pi_walk2'});
for (const [id, c, t] of [['evt_s1', 1000, T + 100], ['evt_s2', 2500, T + 200], ['evt_s3', 4000, T + 300]]) await refund(id, 'pi_walk2', c, t);
assert.deepEqual(stepsFor('pi_walk2'), stepsFor('pi_walk'));
// Every delivery order of three events converges on the same history.
for (const perm of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
  const list = [[1000, T + 100], [2500, T + 200], [4000, T + 300]];
  const fake = perm.map(i => ({id: 'e' + i, order_id: 'o', payment_intent: 'pi', amount_cents: 4000, refunded_cents: list[i][0], refunded_at: iso(list[i][1])}));
  assert.deepEqual(plain(refunds.refundSteps(fake).map(s => s.changeCents)), [1000, 1500, 1500], 'order ' + perm);
  assert.equal(refunds.refundedByOrder(fake).get('o').cents, 4000);
}

// Partial, then the rest.
order('camp', 'event', 16000, {label: 'Fall camp'});
await pay('camp', 16000, {payment_intent: 'pi_camp'});
assert.equal((await refund('evt_c1', 'pi_camp', 6000, T + 50, {amount: 16000})).outcome, 'partial-refund');
assert.equal(status('camp'), 'paid');
assert.equal((await refund('evt_c2', 'pi_camp', 16000, T + 60, {amount: 16000})).outcome, 'refunded');
assert.equal(status('camp'), 'refunded');
assert.deepEqual(stepsFor('pi_camp').map(s => s[0]), [6000, 10000]);

// Refused: the other Stripe mode, more than was paid, or a total that isn't whole cents. Nothing is stored for them.
const before = rows('SELECT * FROM payment_refunds').length;
order('kept', 'walkin', 4000);
await pay('kept', 4000, {payment_intent: 'pi_kept'});
assert.equal((await refund('evt_live', 'pi_kept', 1000, T + 10, {livemode: true})).outcome, 'rejected:mode-mismatch', 'a live refund never touches a test payment');
assert.equal((await refund('evt_over', 'pi_kept', 5000, T + 10)).outcome, 'rejected:refund-amount');
assert.equal((await event('evt_frac', 'charge.refunded', {payment_intent: 'pi_kept', amount: 4000, amount_refunded: 10.5, refunded: false})).outcome, 'rejected:refund-amount');
assert.equal(rows('SELECT * FROM payment_refunds').length, before); assert.equal(status('kept'), 'paid');
assert.equal((await refund('evt_nobody', 'pi_not_ours', 1000, T)).outcome, 'ignored:unknown-payment', 'a charge the site did not take is ignored');

// ---------- Fees: read from Stripe after the payment; a lookup that fails changes nothing else ----------
const settled = (id, amount, fee, created = T, livemode = false) => ({id, object: 'payment_intent', livemode,
  latest_charge: {id: 'ch_' + id, status: 'succeeded', created, balance_transaction: {id: 'txn_' + id, amount, fee, net: amount - fee, currency: 'usd', created}}});
intents = {pi_walk: settled('pi_walk', 4000, 146), pi_walk2: settled('pi_walk2', 4000, 146), pi_camp: settled('pi_camp', 16000, 494),
  pi_kept: {id: 'pi_kept', livemode: false, latest_charge: {id: 'ch_kept', status: 'succeeded', created: T, balance_transaction: null}}};   // not settled yet
failIntent = new Set(['pi_walk2']);
stripeCalls.length = 0;
const statuses = () => rows("SELECT id,status FROM orders ORDER BY id");
const was = statuses();
let run = await fees.recordStripeFees();
assert.equal(run.mode, 'test'); assert.equal(run.checked, 4); assert.equal(run.recorded, 2); assert.equal(run.failed, 1); assert.equal(run.waiting, 2);
assert.match(run.error, /having a moment/);
assert.ok(stripeCalls.every(c => c[0] === 'test' && c[1] === 'paymentIntents.retrieve' && c[3].expand[0] === 'latest_charge.balance_transaction'), 'test key, one read per payment');
assert.deepEqual(statuses(), was, 'reading fees never changes a payment');
assert.deepEqual(rows("SELECT order_id,charge_id,balance_transaction,amount_cents,fee_cents,net_cents,charged_at,livemode FROM stripe_fees WHERE payment_intent='pi_walk'"),
  [{order_id: 'walk', charge_id: 'ch_pi_walk', balance_transaction: 'txn_pi_walk', amount_cents: 4000, fee_cents: 146, net_cents: 3854, charged_at: iso(T), livemode: 0}]);
// The next run tries again: the failed lookup and the payment Stripe hadn't settled.
failIntent.clear(); intents.pi_kept = settled('pi_kept', 4000, 146);
run = await fees.recordStripeFees();
assert.equal(run.recorded, 2); assert.equal(run.waiting, 0); assert.equal(run.error, null);
stripeCalls.length = 0;
run = await fees.recordStripeFees();
assert.equal(stripeCalls.length, 0, 'nothing waiting: Stripe is not called'); assert.equal(run.checked, 0);
assert.equal(rows('SELECT * FROM stripe_fees').length, 4, 'one fee per payment, never twice');

// A key without permission stops the run at once with a plain explanation; nothing else is touched.
for (const id of ['k1', 'k2']) { order(id, 'walkin', 4000); await pay(id, 4000, {payment_intent: 'pi_' + id}); intents['pi_' + id] = settled('pi_' + id, 4000, 146); }
refuseKey = true; stripeCalls.length = 0;
run = await fees.recordStripeFees();
assert.equal(run.error, fees.KEY_PERMISSION_HELP); assert.match(run.error, /Balance \(read\)/);
assert.equal(stripeCalls.length, 1, 'stops after the first refusal'); assert.equal(run.waiting, 2);
assert.equal(status('k1'), 'paid'); assert.equal(status('k2'), 'paid');
refuseKey = false;
// Without a saved key nothing is read; with a small budget only that many calls are made.
delete keys.test; stripeCalls.length = 0;
run = await fees.recordStripeFees();
assert.equal(run.skipped, 'no-key'); assert.equal(stripeCalls.length, 0); assert.equal(run.waiting, 2);
keys.test = 'rk_test_unit';
run = await fees.recordStripeFees(1);
assert.equal(run.checked, 1); assert.equal(run.waiting, 1);
await fees.recordStripeFees();

// ---------- Test and live stay apart ----------
// A live payment made while the site is still in test mode is not read with the test key, and the reverse.
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,stripe_payment_intent,livemode,created_at,updated_at,paid_at,source)
  VALUES ('livewalk','u-l','l@example.test','w-l','Lee Live','walkin','Intermediate','item-l','Walk-in practice','[]',4000,0,4000,'usd','{}','{}','paid','k-livewalk','pi_live',1,'t','t',?,'stripe')`).run(new Date().toISOString());
stripeCalls.length = 0;
run = await fees.recordStripeFees();
assert.equal(run.checked, 0, 'test mode never reads a live payment');
env.STRIPE_MODE = 'live';
intents.pi_live = settled('pi_live', 4000, 146, T, false);           // Stripe answering from the wrong mode is refused
run = await fees.recordStripeFees();
assert.equal(run.recorded, 0); assert.match(run.error, /other mode/); assert.ok(stripeCalls.every(c => c[0] === 'live'), 'live payments are read with the live key');
intents.pi_live = settled('pi_live', 4000, 146, T, true);
run = await fees.recordStripeFees();
assert.equal(run.recorded, 1); assert.equal(rows("SELECT livemode FROM stripe_fees WHERE payment_intent='pi_live'")[0].livemode, 1);
assert.equal((await refund('evt_live_wrong', 'pi_live', 1000, T)).outcome, 'rejected:mode-mismatch', 'a test refund never touches a live payment');
const feeDay = nyDay(new Date(T * 1000));
assert.ok((await books.ledgerLines(feeDay, feeDay)).some(l => l.id === 'fee:pi_live'), 'live books show the live fee');
assert.ok(!(await books.ledgerLines(feeDay, feeDay)).some(l => l.id === 'fee:pi_walk'), 'and no test fee');
delete env.STRIPE_MODE;
assert.ok(!(await books.ledgerLines(feeDay, feeDay)).some(l => l.id === 'fee:pi_live'), 'test books leave out the live fee');

// ---------- Monthly memberships: fees for each monthly payment; a refund of one month is recorded ----------
order('month', 'monthly', 20000);
assert.equal((await pay('month', 20000, {subscription: 'sub_m'})).outcome, 'paid');
assert.equal((await event('evt_inv2', 'invoice.paid', {subscription: 'sub_m', billing_reason: 'subscription_cycle', amount_paid: 20000})).outcome, 'installment-2');
const inv = (id, amount, list) => ({id, object: 'invoice', livemode: false, amount_paid: amount, parent: {subscription_details: {subscription: 'sub_m'}}, ...(list ? {payments: {data: list}} : {})});
const ip = intent => ({status: 'paid', payment: {type: 'payment_intent', payment_intent: intent}});
invoices.sub_m = [inv('in_1', 20000, [ip('pi_m1')]), inv('in_2', 20000), inv('in_adjust', 500, [ip('pi_odd')])];
invoicePayments = {in_1: [ip('pi_m1')], in_2: [ip('pi_m2')], in_3: [ip('pi_m3')]};
intents.pi_m1 = settled('pi_m1', 20000, 610); intents.pi_m2 = settled('pi_m2', 20000, 610);
assert.equal(await fees.feesWaiting(), 2, 'both monthly payments wait for a fee');
stripeCalls.length = 0;
run = await fees.recordStripeFees();
assert.equal(run.recorded, 2); assert.equal(run.waiting, 0);
assert.deepEqual(plain(stripeCalls.map(c => c[1])), ['invoices.list', 'paymentIntents.retrieve', 'invoicePayments.list', 'paymentIntents.retrieve'], 'invoices for the subscription, then each payment');
assert.equal(stripeCalls[0][2].subscription, 'sub_m');
assert.ok(!stripeCalls.some(c => c[2] === 'pi_odd'), 'an invoice for another amount is not one of the membership payments');
assert.deepEqual(rows("SELECT payment_intent FROM stripe_fees WHERE order_id='month' ORDER BY 1").map(r => r.payment_intent), ['pi_m1', 'pi_m2']);

// A refund of the second month: the payment is found from its recorded fee, without asking Stripe.
stripeCalls.length = 0;
assert.equal((await refund('evt_m2_part', 'pi_m2', 5000, T + 500, {amount: 20000})).outcome, 'installment-partial-refund');
assert.equal(stripeCalls.length, 0); assert.equal(status('month'), 'paid', 'the membership itself is not ended by refunding a month');
// A month whose fee isn't recorded yet is found through Stripe's invoice for that payment.
invoices.sub_m.push(inv('in_3', 20000, [ip('pi_m3')]));
assert.equal((await refund('evt_m3_full', 'pi_m3', 20000, T + 600, {amount: 20000})).outcome, 'installment-refunded');
assert.deepEqual(plain(stripeCalls.map(c => [c[0], c[1], c[2].payment])), [['test', 'invoicePayments.list', {type: 'payment_intent', payment_intent: 'pi_m3'}]]);
assert.equal(rows("SELECT order_id FROM payment_refunds WHERE payment_intent='pi_m3'")[0].order_id, 'month');
// If Stripe can't be reached the event is not recorded, so Stripe sends it again.
await assert.rejects(refund('evt_m_down', 'pi_stripe_down', 1000, T + 700, {amount: 20000}));
assert.equal(rows("SELECT * FROM stripe_events WHERE id='evt_m_down'").length, 0, 'left for Stripe to retry');
assert.equal((await refund('evt_other', 'pi_someone_else', 1000, T + 700)).outcome, 'ignored:unknown-payment', 'a charge that is not one of ours is ignored');

// ---------- The books: refunds on the day of the refund, fees as their own expense ----------
// A partial refund made later lands on the day it was made, not the day of the payment.
order('later', 'walkin', 4000);
await pay('later', 4000, {payment_intent: 'pi_later'});
const later = Math.floor(Date.now() / 1000) + 40 * 86400, laterDay = nyDay(new Date(later * 1000));
assert.equal((await refund('evt_later', 'pi_later', 1500, later)).outcome, 'partial-refund');
let lines = await books.ledgerLines(today, today);
assert.ok(lines.some(l => l.id === 'payment:later' && l.amountCents === 4000), 'the payment came in today, in full');
assert.ok(!lines.some(l => l.id === 'refund:evt_later'), 'its refund is not today');
assert.deepEqual(plain((await books.ledgerLines(laterDay, laterDay)).filter(l => l.type === 'refund').map(l => [l.id, l.amountCents, l.description])),
  [['refund:evt_later', 1500, 'Partial refund ($15.00 of $40.00 refunded so far): Walk-in practice · Sam later']]);
assert.ok((await books.ledgerReport(laterDay.slice(0, 7))).totals.refundsCents >= 1500, 'and in that month\'s totals');

lines = await books.ledgerLines('2020-01-01', laterDay);
const of = prefix => lines.filter(l => l.id.startsWith(prefix));
const walkRefunds = plain(lines).filter(l => l.type === 'refund' && l.description.endsWith('· Sam walk')).map(l => [l.amountCents, l.description.split(':')[0]]).sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
assert.deepEqual(walkRefunds, [[1000, 'Partial refund ($10.00 of $40.00 refunded so far)'], [1500, 'Partial refund ($25.00 of $40.00 refunded so far)'], [1500, 'Refund of the rest ($40.00 refunded in all)']]);
assert.deepEqual(plain(lines).filter(l => l.type === 'refund' && l.description.endsWith('Sam camp')).map(l => l.amountCents).sort((a, b) => a - b), [6000, 10000], 'partial then full: the full refund is only the rest');
// Each refund counts once, whatever order Stripe sent them in: refunds in the books equal Stripe's final totals.
const stripeRefunded = rows('SELECT payment_intent,max(refunded_cents) c FROM payment_refunds WHERE livemode=0 GROUP BY payment_intent').reduce((n, r) => n + r.c, 0);
assert.equal(of('refund:evt_').reduce((n, l) => n + l.amountCents, 0), stripeRefunded, 'refunds in the books match Stripe');
const feeLines = of('fee:');
assert.deepEqual(plain(feeLines).map(l => [l.id, l.type, l.category, l.amountCents]).sort(), [
  ['fee:pi_camp', 'expense', 'Card processing fees', 494], ['fee:pi_k1', 'expense', 'Card processing fees', 146], ['fee:pi_k2', 'expense', 'Card processing fees', 146],
  ['fee:pi_kept', 'expense', 'Card processing fees', 146], ['fee:pi_m1', 'expense', 'Card processing fees', 610], ['fee:pi_m2', 'expense', 'Card processing fees', 610],
  ['fee:pi_walk', 'expense', 'Card processing fees', 146], ['fee:pi_walk2', 'expense', 'Card processing fees', 146]], 'one fee per test-mode card payment, refunded ones included');
assert.equal(feeLines.find(l => l.id === 'fee:pi_walk').description, 'Stripe fee: Walk-in practice · Sam walk');
const t = books.totals(lines);
assert.equal(t.expensesCents, 494 + 146 * 5 + 610 * 2, 'fees are expenses');
assert.equal(t.netCents, t.incomeCents - t.refundsCents - t.expensesCents);
assert.ok(books.categories(lines).out.some(c => c.category === 'Card processing fees' && c.cents === t.expensesCents));
// The spreadsheet adds up to the same totals.
// One spreadsheet row into its cells (quoted cells keep their quotes; none of the checked ones are quoted).
const cells = l => { const out = []; let cell = '', quoted = false; for (const ch of l) { if (ch === '"') quoted = !quoted; if (ch === ',' && !quoted) { out.push(cell); cell = ''; } else cell += ch; } out.push(cell); return out; };
const csvRows = books.ledgerCsv(lines).trim().split('\r\n').slice(1).map(cells);
const cents = v => v ? Math.round(Number(v) * 100) : 0;
assert.equal(csvRows.reduce((n, c) => n + cents(c[6]), 0), t.incomeCents);
assert.equal(csvRows.reduce((n, c) => n + cents(c[7]), 0), t.refundsCents + t.expensesCents);
assert.ok(csvRows.some(c => c[1] === 'Expense' && c[3] === 'Card processing fees' && c[2] === 'Card payment'));
assert.ok(csvRows.some(c => c[1] === 'Refund' && /^"?Partial refund/.test(c[4])));
// A full refund recorded before refund totals were stored still counts once, on its old date.
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,stripe_payment_intent,livemode,created_at,updated_at,paid_at,source)
  VALUES ('old','u-o','o@example.test','w-o','Sam old','walkin','Intermediate','item-o','Walk-in practice','[]',4000,0,4000,'usd','{}','{}','refunded','k-old','pi_old',0,'t',?,?,'stripe')`).run(new Date().toISOString(), new Date().toISOString());
sqlite.prepare("INSERT INTO stripe_events VALUES ('evt_old_refund','charge.refunded','old','refunded',?)").run(new Date().toISOString());
assert.deepEqual(plain(await books.ledgerLines(today, today)).filter(l => l.id === 'refund:old').map(l => l.amountCents), [4000]);

// ---------- /payments: refunded so far, fee and net per row ----------
const list = await payments.listPayments({});
const row = id => list.payments.find(p => p.id === id);
assert.deepEqual([row('walk').status, row('walk').refundedCents, row('walk').feeCents, row('walk').netCents, row('walk').cardPayments], ['refunded', 4000, 146, 3854, 1]);
assert.deepEqual([row('later').status, row('later').refundedCents, row('later').refundedOn, row('later').feeCents], ['paid', 1500, laterDay, null], 'partly refunded; fee not read yet');
assert.deepEqual([row('month').refundedCents, row('month').cardPayments, row('month').feeCents, row('month').netCents], [25000, 2, 1220, 38780], 'a monthly row covers each payment so far');
assert.deepEqual([row('old').refundedCents, row('old').refundedOn], [4000, today], 'an older full refund');
assert.equal(row('kept').refundedCents, 0);
const paidStripe = list.payments.filter(p => p.status === 'paid' && p.source === 'stripe');
assert.equal(list.totals.onlineCents, paidStripe.reduce((n, p) => n + p.amountCents - p.refundedCents, 0), 'partial refunds come off what was collected');
assert.equal(list.totals.refundedCents, list.payments.reduce((n, p) => n + p.refundedCents, 0));
assert.equal(list.totals.feesCents, list.payments.reduce((n, p) => n + (p.feeCents ?? 0), 0));
const pcsv = payments.paymentsCsv(list.payments).trim().split('\r\n');
assert.deepEqual(pcsv[0].split(',').slice(-5), ['Refunded', 'Refunded on', 'Card payments', 'Stripe fee', 'Net after Stripe fee']);
const csvOf = id => cells(pcsv[list.payments.findIndex(x => x.id === id) + 1]).slice(-5);
assert.deepEqual(csvOf('walk'), ['40.00', nyDay(new Date((T + 300) * 1000)), '1', '1.46', '38.54']);
assert.deepEqual(csvOf('later'), ['15.00', laterDay, '1', '', ''], 'a fee not read yet is blank, not zero');
assert.deepEqual(csvOf('month'), ['250.00', nyDay(new Date((T + 600) * 1000)), '2', '12.20', '387.80']);

// ---------- The owner's button and the waiting count ----------
const post = body => financialsApi.POST(new Request('https://a.test/api/financials', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://a.test'}, body: JSON.stringify(body)}));
const waiting = async () => (await (await financialsApi.GET(new Request('https://a.test/api/financials'))).json()).feesWaiting;
intents.pi_later = settled('pi_later', 4000, 146); intents.pi_old = settled('pi_old', 4000, 146);
assert.equal(await waiting(), 2, 'the payment refunded later and the older refunded one');
let res = await post({action: 'fees'});
assert.equal(res.status, 200); assert.deepEqual(plain(await res.json()), {ok: true, mode: 'test', checked: 2, recorded: 2, failed: 0, waiting: 0, error: null, skipped: null});
assert.equal(await waiting(), 0);
delete keys.test;
order('nokey', 'walkin', 4000); await pay('nokey', 4000, {payment_intent: 'pi_nokey'});
res = await post({action: 'fees'});
assert.equal(res.status, 409); assert.match((await res.json()).error, /Payment setup/);
keys.test = 'rk_test_unit';

// ---------- The /payments page (inline script, not typechecked): partial refunds and fees show clearly ----------
{
  const html = readFileSync('app/payments/screen.html', 'utf8'), nodes = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, disabled: false, innerHTML: '', textContent: '', href: '', max: '', style: {}, dataset: {}}); return nodes.get(id); };
  const data = await payments.listPayments({});
  const fetch = async u => ({ok: true, status: 200, json: async () => u.startsWith('/api/payments?families') ? {families: []} : u.startsWith('/api/public-schedule') ? {programs: [], practices: [], events: [], liveClasses: []} : u === '/api/lessons' ? {formats: [], openings: []} : JSON.parse(JSON.stringify(data))});
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, console, fetch, prompt: () => null, document: {getElementById: el, querySelectorAll: () => []}});
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  const money = c => '$' + (c / 100).toLocaleString('en-US', {minimumFractionDigits: 2});
  assert.equal(el('tFees').textContent, money(data.totals.feesCents), 'a Stripe card fees total');
  assert.equal(el('tRefunded').textContent, money(data.totals.refundedCents));
  const rowsHtml = el('rows').innerHTML;
  assert.match(rowsHtml, /Sam later<\/b>[\s\S]*?\$40\.00<br><span class="muted">Stripe fee \$1\.46<\/span>[\s\S]*?badge paid">Paid<\/span><br><span class="muted">\$15\.00 of \$40\.00 refunded, last on /, 'a partial refund stays Paid and says how much');
  assert.match(rowsHtml, /Sam nokey<\/b>[\s\S]*?\$40\.00<br><span class="muted">Stripe fee not in yet<\/span>/, 'a fee not read yet says so');
  assert.match(rowsHtml, /Sam walk<\/b>[\s\S]*?Stripe fee \$1\.46<\/span>[\s\S]*?badge refunded">Refunded<\/span><br><span class="muted">\$40\.00 refunded, last on /);
  assert.match(rowsHtml, /Sam month<\/b>[\s\S]*?Stripe fee \$12\.20 for 2 payments[\s\S]*?\$250\.00 of \$400\.00 refunded/, 'a monthly row covers each payment so far');
  assert.doesNotMatch(html, /\son[a-z]+="/, 'no inline handlers');
}

console.log('Card refund and fee tests passed');
