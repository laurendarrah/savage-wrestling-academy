// Issue #194: the academy's books. Owner only; amounts in whole cents; card payments (through the real Stripe webhook
// code), monthly installments, refunds and offline payments appear on their own and are counted exactly once.
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
const stripeClient = {subscriptions: {retrieve: async id => ({id, billing_cycle_anchor: Math.floor(Date.now() / 1000), metadata: {}}), update: async id => ({id})}};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, TextEncoder, Uint8Array, Intl, Date, URL, URLSearchParams, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, RegExp, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.endsWith('/stripe-test')) return {storedStripeKeyFor: async () => 'rk_test_unit', stripeClientFor: () => stripeClient};
        if (name.endsWith('/notify')) return {noticeLessonBooked: async () => {}, noticePaymentRecorded: async () => {}, quietly: async f => { try { await f(); } catch {} }};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
const api = load(path.resolve('app/api/financials/route.ts'));
const webhook = load(path.resolve('lib/stripe-webhook.ts'));
const lib = load(path.resolve('lib/financials.ts'));
const O = 'https://a.test';
const get = async q => { const r = await api.GET(new Request(O + '/api/financials' + q)); return {status: r.status, type: r.headers.get('content-type'), text: await r.text(), json() { return JSON.parse(this.text); }}; };
const post = async (body, origin = O) => { const r = await api.POST(new Request(O + '/api/financials', {method: 'POST', headers: {'content-type': 'application/json', origin}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'}), month = today.slice(0, 7), year = today.slice(0, 4);

// ---------- Owner only ----------
actor = {owner: false, id: 'family-1'};
assert.equal((await get('')).status, 403, 'families and coaches cannot read the books');
assert.equal((await get('?format=csv')).status, 403, 'or download them');
assert.equal((await post({action: 'add', kind: 'expense', date: today, amountCents: 100, category: 'Rent'})).status, 403, 'or change them');
actor = {owner: true, id: 'owner-id'};
assert.equal((await post({action: 'add', kind: 'expense', date: today, amountCents: 100, category: 'Rent'}, 'https://evil.test')).status, 403, 'same-origin writes only');
assert.equal((await get('?month=2026-13')).status, 400);
assert.equal((await get('?month=1999-12')).status, 400);
assert.equal((await get('?format=csv&year=20x6')).status, 400);

// ---------- A new site has empty books: no sample data ----------
{
  const r = (await get('')).json();
  assert.equal(r.month, month); assert.equal(r.lines.length, 0); assert.equal(r.months.length, 12);
  assert.deepEqual(r.yearTotals, {incomeCents: 0, refundsCents: 0, expensesCents: 0, netCents: 0});
  assert.equal(r.stripeMode, 'test');
  assert.ok(r.suggestions.expense.includes('Rent') && r.suggestions.expense.includes('Insurance') && r.suggestions.income.includes('Sponsorship'));
}

// ---------- Payments come from orders, through the same code that marks them paid ----------
const order = (id, kind, cents, extra = {}) => {
  const o = {status: 'pending', livemode: 0, source: 'stripe', paid_at: null, pricing: '{}', label: kind === 'monthly' ? 'SWA Intermediate monthly membership' : kind === 'annual' ? 'SWA Intermediate 12-month membership' : 'Walk-in practice', ...extra};
  sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
    VALUES (?,?,?,?,?,?,'Intermediate',?,?,'[]',?,0,?,'usd',?,'{}',?,?,?,'t','t',?,?)`).run(id, 'u-' + id, id + '@example.test', 'w', 'Sam ' + id, kind, 'item-' + id, o.label, cents, cents, o.pricing, o.status, 'k-' + id, o.livemode, o.paid_at, o.source);
};
const event = (id, type, object) => webhook.applyStripeEvent({id, type, livemode: false, data: {object}});
const checkoutPaid = (id, orderId, cents, extra = {}) => event(id, 'checkout.session.completed', {id: 'cs_' + orderId, client_reference_id: orderId, livemode: false, payment_status: 'paid', amount_total: cents, currency: 'usd', ...extra});

order('walk', 'walkin', 4000);
assert.equal((await checkoutPaid('evt_walk', 'walk', 4000, {payment_intent: 'pi_walk'})).outcome, 'paid');
assert.equal((await checkoutPaid('evt_walk', 'walk', 4000, {payment_intent: 'pi_walk'})).duplicate, true, 'a repeated delivery is ignored');
assert.equal((await event('evt_walk_late', 'checkout.session.async_payment_succeeded', {id: 'cs_walk', client_reference_id: 'walk', livemode: false, amount_total: 4000, currency: 'usd'})).outcome, 'ignored:already-paid');

order('year', 'annual', 240000);
await checkoutPaid('evt_year', 'year', 240000, {payment_intent: 'pi_year'});
assert.equal((await event('evt_year_refund', 'charge.refunded', {payment_intent: 'pi_year', refunded: true, amount_refunded: 240000})).outcome, 'refunded');
assert.equal((await event('evt_year_refund', 'charge.refunded', {payment_intent: 'pi_year', refunded: true, amount_refunded: 240000})).duplicate, true);

order('partial', 'walkin', 4000);
await checkoutPaid('evt_partial', 'partial', 4000, {payment_intent: 'pi_partial'});
assert.equal((await event('evt_partial_refund', 'charge.refunded', {payment_intent: 'pi_partial', refunded: false, amount_refunded: 1000})).outcome, 'partial-refund');

order('month', 'monthly', 20000);
assert.equal((await checkoutPaid('evt_month', 'month', 20000, {subscription: 'sub_month'})).outcome, 'paid');
assert.equal((await event('evt_inv_first', 'invoice.paid', {subscription: 'sub_month', billing_reason: 'subscription_create', amount_paid: 20000})).outcome, 'ignored:first-payment-counted-at-checkout', 'the first installment is the checkout payment');
assert.equal((await event('evt_inv_2', 'invoice.paid', {subscription: 'sub_month', billing_reason: 'subscription_cycle', amount_paid: 20000})).outcome, 'installment-2-of-12');
assert.equal((await event('evt_inv_2', 'invoice.paid', {subscription: 'sub_month', billing_reason: 'subscription_cycle', amount_paid: 20000})).duplicate, true);
assert.equal((await event('evt_inv_fail', 'invoice.payment_failed', {subscription: 'sub_month'})).outcome, 'installment-failed');
assert.equal((await event('evt_inv_3', 'invoice.paid', {subscription: 'sub_month', billing_reason: 'subscription_cycle', amount_paid: 20000})).outcome, 'installment-3-of-12');
// Issue #271: a payment for another amount (a coupon or a price edit in Stripe) counts for what Stripe collected.
assert.equal((await event('evt_inv_odd', 'invoice.paid', {subscription: 'sub_month', billing_reason: 'subscription_cycle', amount_paid: 1})).outcome, 'installment-4-of-12', 'a different amount still counts');

order('never', 'walkin', 4000);                                                             // started checkout, never paid
order('expired', 'walkin', 4000);
await event('evt_expired', 'checkout.session.expired', {id: 'cs_expired', client_reference_id: 'expired', livemode: false});
order('live', 'walkin', 4000, {status: 'paid', livemode: 1, paid_at: new Date().toISOString()});   // a live-mode payment while the site is in test mode
order('cash', 'walkin', 5000, {status: 'paid', source: 'offline', paid_at: today + 'T12:00:00.000Z', pricing: JSON.stringify({method: 'cash', note: 'paid at the door'})});
order('oops', 'walkin', 5000, {status: 'canceled', source: 'offline', paid_at: today + 'T12:00:00.000Z', pricing: JSON.stringify({method: 'check', voidReason: 'entered twice'})});
order('free', 'walkin', 0, {status: 'paid', source: 'offline', paid_at: today + 'T12:00:00.000Z', pricing: JSON.stringify({method: 'other'})});
// Paid at 11:30 PM in New York on October 31 is October income, though it is November 1 in UTC.
order('halloween', 'event', 9000, {status: 'paid', paid_at: '2025-11-01T03:30:00.000Z', label: 'Fall camp'});
order('newyear', 'event', 9000, {status: 'paid', paid_at: '2026-01-01T04:59:00.000Z', label: 'Winter camp'});   // Dec 31, 2025 in New York

let r = (await get('?month=' + month)).json();
const ids = r.lines.map(l => l.id).sort();
assert.deepEqual(ids, ['installment:evt_inv_2', 'installment:evt_inv_3', 'installment:evt_inv_odd', 'payment:cash', 'payment:month', 'payment:partial', 'payment:walk', 'payment:year', 'refund:evt_partial_refund', 'refund:evt_year_refund'],
  'each payment once; refunds out; nothing unpaid, expired, voided, free or from the other Stripe mode');
const line = id => r.lines.find(l => l.id === id);
assert.equal(line('payment:walk').source, 'online'); assert.equal(line('payment:walk').method, 'Card online'); assert.equal(line('payment:walk').category, 'Walk-ins');
assert.equal(line('payment:cash').source, 'offline'); assert.equal(line('payment:cash').method, 'Cash');
assert.equal(line('payment:month').description, 'SWA Intermediate monthly membership (payment 1 of 12) · Sam month');
assert.equal(line('installment:evt_inv_3').description, 'SWA Intermediate monthly membership (payment 3 of 12) · Sam month');
assert.equal(line('installment:evt_inv_odd').amountCents, 1, 'the books show what Stripe collected (issue #271)'); assert.equal(line('installment:evt_inv_3').amountCents, 20000);
assert.equal(line('refund:evt_year_refund').type, 'refund'); assert.equal(line('refund:evt_year_refund').amountCents, 240000); assert.equal(line('refund:evt_year_refund').category, 'Refunds');
// Issue #42: a partial refund leaves the payment in full and goes out as its own refund line.
assert.equal(line('payment:partial').amountCents, 4000, 'the payment came in in full');
assert.equal(line('refund:evt_partial_refund').amountCents, 1000); assert.match(line('refund:evt_partial_refund').description, /^Partial refund \(\$10\.00 of \$40\.00 refunded so far\): Walk-in practice/);
assert.ok(r.lines.every(l => Number.isSafeInteger(l.amountCents) && l.amountCents > 0), 'whole, positive cents');
const income = 4000 + 240000 + 4000 + 20000 * 3 + 1 + 5000;
const refunded = 240000 + 1000;
assert.deepEqual(r.totals, {incomeCents: income, refundsCents: refunded, expensesCents: 0, netCents: income - refunded});
assert.deepEqual(r.categories.out, [{category: 'Refunds', cents: refunded}]);
assert.equal(r.categories.in[0].category, 'Memberships, paid in full');
assert.equal(r.categories.in.reduce((n, c) => n + c.cents, 0), income);

// Time zone: payments land on their New York date.
r = (await get('?month=2025-10')).json();
assert.deepEqual(r.lines.map(l => [l.id, l.date]), [['payment:halloween', '2025-10-31']]);
assert.equal(r.months[10].incomeCents, 0, 'not in November');
r = (await get('?month=2025-12')).json();
assert.deepEqual(r.lines.map(l => [l.id, l.date]), [['payment:newyear', '2025-12-31']]);
assert.deepEqual(r.yearTotals, {incomeCents: 18000, refundsCents: 0, expensesCents: 0, netCents: 18000}, '2025 has both camps');
assert.ok(!(await get('?format=csv&year=2026')).text.includes('Winter camp'), 'the new-year camp stays in 2025');

// Stripe live: only live card payments count; offline payments always do.
env.STRIPE_MODE = 'live';
r = (await get('?month=' + month)).json();
assert.equal(r.stripeMode, 'live');
assert.deepEqual(r.lines.map(l => l.id).sort(), ['payment:cash', 'payment:live']);
delete env.STRIPE_MODE;

// Voiding an offline payment takes it out of the books; nothing else needs changing.
sqlite.prepare("UPDATE orders SET status='canceled' WHERE id='cash'").run();
assert.equal((await get('?month=' + month)).json().totals.incomeCents, income - 5000);
sqlite.prepare("UPDATE orders SET status='paid' WHERE id='cash'").run();

// ---------- The owner's own entries ----------
const add = body => post({action: 'add', kind: 'expense', date: today, category: 'Rent', ...body});
for (const [body, why] of [[{amountCents: 12.5}, 'fractions of a cent'], [{amountCents: '1250'}, 'text amounts'], [{amountCents: 0}, 'zero'], [{amountCents: -500}, 'negative'],
  [{amountCents: 100000001}, 'over $1,000,000'], [{amountCents: 100, kind: 'refund'}, 'unknown kind'], [{amountCents: 100, category: '  '}, 'no category'],
  [{amountCents: 100, category: 'x'.repeat(61)}, 'long category'], [{amountCents: 100, date: '2999-01-01'}, 'future date'], [{amountCents: 100, date: '2026-02-30'}, 'impossible date'],
  [{amountCents: 100, note: 'x'.repeat(301)}, 'long note'], [{amountCents: 100, receipt: 'x'.repeat(201)}, 'long receipt'], [{amountCents: 100, amount: '1.00', amountCents: undefined}, 'dollars instead of cents']])
  assert.equal((await add(body)).status, 400, why);
assert.equal((await post({action: 'refund-everything'})).status, 400);
assert.equal(sqlite.prepare('SELECT count(*) n FROM financial_entries').get().n, 0, 'nothing invalid was saved');

const rent = await add({amountCents: 180000, category: '  Rent ', note: 'November   rent', receipt: 'Check 1042'});
assert.equal(rent.status, 200); assert.equal(rent.body.revision, 1);
const gear = await add({amountCents: 34999, category: 'Equipment', note: 'New mat tape'});
const sponsor = await add({kind: 'income', amountCents: 25000, category: 'Sponsorship', note: 'Local diner'});
const formula = await add({amountCents: 100, category: '=HYPERLINK("x")', note: '+1 dial'});
const stored = sqlite.prepare("SELECT * FROM financial_entries WHERE id=?").get(rent.body.id);
assert.equal(stored.category, 'Rent'); assert.equal(stored.note, 'November rent'); assert.equal(stored.amount_cents, 180000); assert.equal(stored.created_by, 'owner-id');

r = (await get('?month=' + month)).json();
const expenses = 180000 + 34999 + 100;
assert.deepEqual(r.totals, {incomeCents: income + 25000, refundsCents: refunded, expensesCents: expenses, netCents: income + 25000 - refunded - expenses});
assert.deepEqual(r.categories.out.slice(0, 3), [{category: 'Refunds', cents: refunded}, {category: 'Rent', cents: 180000}, {category: 'Equipment', cents: 34999}]);
const rentLine = r.lines.find(l => l.entryId === rent.body.id);
assert.equal(rentLine.source, 'owner'); assert.equal(rentLine.receipt, 'Check 1042'); assert.equal(rentLine.revision, 1);
assert.equal(r.months[Number(month.slice(5)) - 1].netCents, r.totals.netCents, 'the month row matches the month');
assert.equal(r.yearTotals.netCents, r.months.reduce((n, m) => n + m.netCents, 0), 'the year is the sum of its months');

// Edit with the revision the owner saw; a stale edit or delete is refused.
const edited = await post({action: 'edit', id: rent.body.id, revision: 1, kind: 'expense', date: today, amountCents: 185000, category: 'Rent', note: 'November rent and utilities', receipt: 'Check 1042'});
assert.equal(edited.status, 200); assert.equal(edited.body.revision, 2);
assert.equal((await post({action: 'edit', id: rent.body.id, revision: 1, kind: 'expense', date: today, amountCents: 1, category: 'Rent'})).status, 409, 'stale edit');
assert.equal((await post({action: 'edit', id: rent.body.id, revision: 2, kind: 'expense', date: today, amountCents: 1.5, category: 'Rent'})).status, 400, 'edits are checked too');
assert.equal((await post({action: 'delete', id: gear.body.id, revision: 7})).status, 409, 'stale delete');
assert.equal((await post({action: 'delete', id: 'no such id', revision: 1})).status, 400);
assert.equal((await post({action: 'delete', id: gear.body.id, revision: 1})).status, 200);
assert.equal((await post({action: 'delete', id: gear.body.id, revision: 2})).status, 409, 'already deleted');
assert.equal((await post({action: 'edit', id: gear.body.id, revision: 2, kind: 'expense', date: today, amountCents: 5, category: 'Equipment'})).status, 409, 'a deleted entry cannot be edited');
assert.equal(sqlite.prepare('SELECT deleted_by FROM financial_entries WHERE id=?').get(gear.body.id).deleted_by, 'owner-id', 'the row is kept with who deleted it');

r = (await get('?month=' + month)).json();
assert.equal(r.totals.expensesCents, 185000 + 100, 'the edit counts and the deleted entry does not');
assert.ok(!r.lines.some(l => l.entryId === gear.body.id));
// Moving an entry to another month moves it in the books.
const lastYear = String(Number(year) - 1) + '-06-15';
assert.equal((await post({action: 'edit', id: sponsor.body.id, revision: 1, kind: 'income', date: lastYear, amountCents: 25000, category: 'Sponsorship'})).status, 200);
assert.equal((await get('?month=' + lastYear.slice(0, 7))).json().totals.incomeCents, 25000);
assert.equal((await get('?month=' + month)).json().totals.incomeCents, income);

const log = sqlite.prepare("SELECT action,actor FROM security_events WHERE action LIKE 'ledger_entry_%' ORDER BY rowid").all().map(e => e.action);
assert.deepEqual(log, ['ledger_entry_added', 'ledger_entry_added', 'ledger_entry_added', 'ledger_entry_added', 'ledger_entry_edited', 'ledger_entry_deleted', 'ledger_entry_edited'], 'every change is logged, refused ones are not');

// ---------- CSV ----------
const csv = await get('?format=csv&month=' + month);
assert.match(csv.type, /text\/csv/);
const rows = csv.text.trim().split('\r\n');
assert.equal(rows[0], 'Date,Type,From,Category,Description,Paid by,Money in,Money out,Receipt reference,Collected by');
r = (await get('?month=' + month)).json();
assert.equal(rows.length, 1 + r.lines.length, 'one row per line in the books');
const cents = s => s ? Math.round(Number(s) * 100) : 0, cells = l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, ''));
const body = rows.slice(1).map(cells);
assert.equal(body.reduce((n, c) => n + cents(c[6]), 0), r.totals.incomeCents, 'money in matches to the cent');
assert.equal(body.reduce((n, c) => n + cents(c[7]), 0), r.totals.refundsCents + r.totals.expensesCents, 'money out matches to the cent');
assert.ok(rows.some(l => l.includes(`"'=HYPERLINK(""x"")"`)) && rows.some(l => l.includes(`"'+1 dial"`)), 'formula cells are neutralized');
assert.ok(rows.some(l => /^\d{4}-\d{2}-\d{2},Refund,Card payment,Refunds,/.test(l)));
assert.deepEqual(body.map(c => c[0]), body.map(c => c[0]).slice().sort(), 'oldest first in the spreadsheet');
const yearCsv = await get('?format=csv&year=' + (Number(year) - 1));
assert.ok(yearCsv.text.includes('Sponsorship'), 'a year download covers the whole year');
assert.ok((await get('?format=csv&year=2025')).text.includes('Fall camp') && (await get('?format=csv&year=2025')).text.includes('Winter camp'));

// Helpers used by the page and the export.
assert.equal(lib.cleanEntry({kind: 'expense', date: '2026-01-05', amountCents: 1, category: 'Rent'}, '2026-01-05').entry.amountCents, 1);
assert.match(lib.cleanEntry({kind: 'expense', date: '2026-01-06', amountCents: 1, category: 'Rent'}, '2026-01-05').error, /future/);
assert.deepEqual({...lib.periodBounds(new URLSearchParams('month=2028-02'))}, {from: '2028-02-01', to: '2028-02-29', label: '2028-02'}, 'leap years');
assert.equal(lib.periodBounds(new URLSearchParams('month=2026-00')), null);
console.log('Books (income and expenses) tests passed');
