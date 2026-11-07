// Rehearsal of online payments (issue #111): the real checkout and webhook code against Stripe's official stripe-mock
// server, which checks every API request against Stripe's published API. Stripe's own hosted checkout page is not
// part of stripe-mock, so the script stops at the redirect and sends the signed webhooks Stripe would send.
// Local only. Usage: bash scripts/e2e/run-payments.sh
import {createRequire} from 'node:module';
import {createHmac} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {start, sessionCookie} from './fake-supabase.mjs';
const require = createRequire(import.meta.url);
const playwright = require('playwright');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8799', AUTH = process.env.E2E_SUPABASE || 'http://127.0.0.1:54321', SECRET = process.env.E2E_WEBHOOK_SECRET;
const SHOTS = process.env.E2E_SHOTS; // optional folder for screenshots of the money screens
const auth = await start(+new URL(AUTH).port), browser = await playwright.chromium.launch();
const ny = k => new Date(Date.now() + k * 864e5).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const problems = [], passed = [];
let current = '';
async function as(name) {
  const ctx = await browser.newContext(); const c = sessionCookie(name, AUTH);
  await ctx.addCookies([{name: c.name, value: c.value, url: BASE}]);
  // Stripe's hosted page is outside the rehearsal: record where checkout sends the family, show a stand-in page.
  await ctx.route('https://checkout.stripe.com/**', r => r.fulfill({contentType: 'text/html', body: '<h1>Stripe Checkout (stand-in)</h1>'}));
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));
  page.on('pageerror', e => problems.push(`[${current}] page error: ${e.message}`));
  page.on('response', r => { if (r.status() >= 500) problems.push(`[${current}] HTTP ${r.status()} ${r.url()}`); });
  return page;
}
async function step(name, fn) { current = name; try { await fn(); passed.push(name); console.log('PASS', name); } catch (e) { problems.push(`[${name}] FAILED: ${e.message.split('\n')[0]}`); console.log('FAIL', name, '-', e.message.split('\n')[0]); } }
const expect = (c, m) => { if (!c) throw new Error(m); };
const api = (page, url, body, method) => page.evaluate(async ([u, b, m]) => { const r = await fetch(u, b ? {method: m || 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)} : {cache: 'no-store'}); return {status: r.status, body: await r.json().catch(() => null)}; }, [url, body, method]);
const waitText = (page, sel, re, ms = 10000) => page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent || ''), [sel, re.source], {timeout: ms});
const sql = q => JSON.parse(execFileSync('node', ['--import', './scripts/local-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', '.wrangler/e2e-pay', '--json', '--command', q], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}))[0].results;
let evt = 0;
async function webhook(type, object) {
  const body = JSON.stringify({id: `evt_rehearsal_${++evt}`, object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000), data: {object}});
  const t = Math.floor(Date.now() / 1000), sig = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  const r = await fetch(BASE + '/api/stripe-webhook', {method: 'POST', headers: {'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}`}, body});
  return {status: r.status, body: await r.json().catch(() => null)};
}

const owner = await as('owner'), family = await as('family');
let walkinOrder = '', monthlyOrder = '';

await step('setup: schedule and a family with a current card', async () => {
  await owner.goto(BASE + '/');
  const weekly = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
  const state = {kids: [], bookings: [], messages: [], offers: [], staff: [], attendance: {}, settings: {},
    programs: [['Elementary', 'SWA Development'], ['Intermediate', 'SWA Intermediate'], ['Advanced', 'SWA Advance']].map(([id, name]) => ({id, name, description: '', priceCents: 20000, walkInPriceCents: 4000})),
    seasons: ['Intermediate'].map(program => ({program, start: ny(-30), end: ny(120), weekly, excludedDates: []}))};
  const got = await api(owner, '/api/academy');
  const r = await api(owner, '/api/academy', {revision: got.body.revision, data: state}, 'PUT'); expect(r.status === 200, 'academy ' + JSON.stringify(r.body));
  await family.goto(BASE + '/family');
  const f = await api(family, '/api/family', {revision: 0, data: {parentName: 'Pat Example', phone: '', homeAddress: '20 Railroad St', homeCity: 'Huntington Station', homeState: 'NY', homeZip: '11746', emergencyContactName: 'Jordan Emergency', emergencyContactPhone: '631-555-0188', wrestlers: [{id: 'w-sam', name: 'Sam Example', grade: '8', usawNumber: 'AB-123456', usawExpires: ny(300), birthDate: '2012-04-18', allergies: 'None'}]}}, 'PUT');
  expect(f.status === 200, 'family ' + JSON.stringify(f.body));
});
await step('owner saves a Stripe test key; Stripe confirms the account', async () => {
  await owner.goto(BASE + '/payment-setup'); await owner.waitForSelector('#testKey');
  await owner.fill('#testKey', 'rk_test_' + 'R'.repeat(24)); await owner.click('#keyForm button');
  await owner.waitForFunction(() => /saved|connected|configured/i.test(document.body.textContent), null, {timeout: 10000});
});
await step('family pays for a walk-in: checkout opens a Stripe session', async () => {
  await family.goto(BASE + '/register'); await family.waitForFunction(() => document.querySelectorAll('#wrestler option').length > 0);
  await family.check('#plan-walkin'); await family.selectOption('#program', 'Intermediate');
  await family.locator(`[data-day="${ny(1)}"]`).first().click(); await family.locator('[data-slot]').first().click();
  await family.click('#reviewButton'); await family.waitForSelector('#acceptTerms', {state: 'visible'});
  await family.check('#acceptTerms');
  if (SHOTS) await family.screenshot({path: `${SHOTS}/pay-review-walkin.png`, fullPage: true});
  await Promise.all([family.waitForURL(/checkout\.stripe\.com/, {timeout: 15000}), family.click('#payButton')]);
  const o = sql("SELECT id,status,amount_cents,stripe_session_id FROM orders WHERE kind='walkin'")[0];
  expect(o && o.status === 'pending' && o.amount_cents === 4000 && /^cs_test_/.test(o.stripe_session_id), 'pending order ' + JSON.stringify(o));
  walkinOrder = o.id;
});
await step('Stripe reports the payment: the walk-in is paid and on the roster', async () => {
  const o = sql(`SELECT stripe_session_id FROM orders WHERE id='${walkinOrder}'`)[0];
  let r = await webhook('checkout.session.completed', {id: o.stripe_session_id, object: 'checkout.session', client_reference_id: walkinOrder, metadata: {order_id: walkinOrder}, payment_status: 'paid', amount_total: 4000, currency: 'usd', livemode: false, payment_intent: 'pi_rehearsal_walkin', mode: 'payment'});
  expect(r.status === 200, 'webhook ' + JSON.stringify(r.body));
  await family.goto(BASE + `/family?checkout=success&order=${walkinOrder}`); await waitText(family, '#paid', /Payment confirmed/);
  if (SHOTS) await family.screenshot({path: `${SHOTS}/pay-confirmed-family.png`, fullPage: true});
  await waitText(family, '#purchaseList', /walk-in[\s\S]*Paid/i);
  const roster = await api(owner, '/api/roster?date=' + ny(1));
  expect(roster.body.sessions.some(s => s.entries.some(e => e.name === 'Sam Example' && e.sources.includes('Walk-in paid'))), 'not on roster');
  // A forged or replayed message changes nothing.
  const bad = await fetch(BASE + '/api/stripe-webhook', {method: 'POST', headers: {'content-type': 'application/json', 'stripe-signature': 't=1,v1=00'}, body: '{}'}); expect(bad.status === 400, 'unsigned webhook accepted: ' + bad.status);
});
await step('the payment shows on /payments as online', async () => {
  await owner.goto(BASE + '/payments'); await waitText(owner, '#rows', /Sam Example[\s\S]*\$40\.00/);
});
await step('card fees are read from stripe-mock on request, without touching the payment (#42)', async () => {
  await owner.goto(BASE + '/financials');
  const r = await api(owner, '/api/financials', {action: 'fees'});
  expect(r.status === 200 && r.body.mode === 'test' && r.body.recorded >= 1 && !r.body.error, 'fee run ' + JSON.stringify(r.body));
  const f = sql("SELECT order_id,fee_cents,livemode FROM stripe_fees WHERE payment_intent='pi_rehearsal_walkin'")[0];
  expect(f && f.order_id === walkinOrder && f.livemode === 0 && Number.isInteger(f.fee_cents), 'fee row ' + JSON.stringify(f));
  expect(sql(`SELECT status FROM orders WHERE id='${walkinOrder}'`)[0].status === 'paid', 'reading fees changed the payment');
  const csv = await owner.evaluate(async () => (await fetch('/api/payments?format=csv', {cache: 'no-store'})).text());
  expect(/,Refunded,Refunded on,Card payments,Stripe fee,Net after Stripe fee\r\n/.test(csv), 'payments CSV has fee columns');
});
await step('a partial refund keeps the walk-in paid and shows on /payments (#42)', async () => {
  const r = await webhook('charge.refunded', {id: 'ch_rehearsal_1', object: 'charge', payment_intent: 'pi_rehearsal_walkin', amount: 4000, refunded: false, amount_refunded: 1500, livemode: false});
  expect(r.status === 200 && r.body.outcome === 'partial-refund', 'partial refund webhook ' + JSON.stringify(r.body));
  expect(sql(`SELECT status FROM orders WHERE id='${walkinOrder}'`)[0].status === 'paid', 'a partial refund un-paid the walk-in');
  await owner.goto(BASE + '/payments'); await waitText(owner, '#rows', /\$15\.00 of \$40\.00 refunded/);
  const books = await api(owner, '/api/financials');
  expect(books.body.lines.some(l => l.type === 'refund' && l.amountCents === 1500), 'partial refund not in the books');
});
await step('a refund in Stripe marks the walk-in refunded and takes Sam off that roster', async () => {
  const r = await webhook('charge.refunded', {id: 'ch_rehearsal_1', object: 'charge', payment_intent: 'pi_rehearsal_walkin', amount: 4000, refunded: true, amount_refunded: 4000, livemode: false});
  expect(r.status === 200, 'refund webhook ' + JSON.stringify(r.body));
  const refunds = (await api(owner, '/api/financials')).body.lines.filter(l => l.type === 'refund').map(l => l.amountCents).sort((a, b) => a - b);
  expect(JSON.stringify(refunds) === '[1500,2500]', 'refunds in the books ' + JSON.stringify(refunds));
  await family.goto(BASE + '/family'); await waitText(family, '#purchaseList', /Refunded/);
  const roster = await api(owner, '/api/roster?date=' + ny(1));
  expect(!roster.body.sessions.some(s => s.entries.some(e => e.name === 'Sam Example')), 'still on roster after refund');
});
await step('a year paid upfront is refused at checkout and nothing is created (#210)', async () => {
  await family.goto(BASE + '/register'); await family.waitForFunction(() => document.querySelectorAll('#wrestler option').length > 0);
  expect(!(await family.$('#plan-annual')), 'no upfront plan on the register page');
  const r = await api(family, '/api/checkout', {source: 'membership', wrestlerId: 'w-sam', program: 'Intermediate', plan: 'annual', acceptTerms: true});
  expect(r.status === 400 && /no longer offered/.test(r.body?.error), 'upfront checkout ' + JSON.stringify(r));
  expect(sql("SELECT count(*) n FROM orders WHERE kind='annual'")[0].n === 0, 'no upfront order');
});
await step('family starts a 12-month membership paid monthly: a Stripe subscription checkout', async () => {
  await family.goto(BASE + '/register'); await family.waitForFunction(() => document.querySelectorAll('#wrestler option').length > 0);
  await family.check('#plan-monthly'); await family.selectOption('#program', 'Intermediate');
  await family.click('#reviewButton'); await family.waitForSelector('#acceptTerms', {state: 'visible'}); await family.check('#acceptTerms');
  if (SHOTS) await family.screenshot({path: `${SHOTS}/pay-review-monthly.png`, fullPage: true});
  await Promise.all([family.waitForURL(/checkout\.stripe\.com/, {timeout: 15000}), family.click('#payButton')]);
  const o = sql("SELECT id,status,amount_cents FROM orders WHERE kind='monthly'")[0];
  expect(o && o.status === 'pending' && o.amount_cents === 20000, 'pending monthly order ' + JSON.stringify(o));
  monthlyOrder = o.id;
});
await step('Stripe reports the first payment: the app sets the 12-payment end date on the subscription', async () => {
  const o = sql(`SELECT stripe_session_id FROM orders WHERE id='${monthlyOrder}'`)[0];
  const r = await webhook('checkout.session.completed', {id: o.stripe_session_id, object: 'checkout.session', client_reference_id: monthlyOrder, metadata: {order_id: monthlyOrder}, payment_status: 'paid', amount_total: 20000, currency: 'usd', livemode: false, subscription: 'sub_rehearsal_1', mode: 'subscription'});
  expect(r.status === 200, 'webhook ' + JSON.stringify(r.body));
  const s = sql("SELECT * FROM subscriptions")[0];
  expect(s && s.payments_made === 1 && s.payments_total === 12 && s.cancel_at, 'subscription ' + JSON.stringify(s));
  await family.goto(BASE + '/family'); await waitText(family, '#membershipCards', /Active membership/);
});
await step('the second monthly payment extends paid-through; a failed one shows "needs attention"', async () => {
  const before = sql("SELECT paid_through FROM subscriptions")[0].paid_through;
  let r = await webhook('invoice.paid', {id: 'in_rehearsal_2', object: 'invoice', subscription: 'sub_rehearsal_1', billing_reason: 'subscription_cycle', amount_paid: 20000, livemode: false});
  expect(r.status === 200, 'invoice.paid ' + JSON.stringify(r.body));
  const s = sql("SELECT payments_made,paid_through FROM subscriptions")[0];
  expect(s.payments_made === 2 && s.paid_through > before, 'not extended ' + JSON.stringify(s));
  r = await webhook('invoice.payment_failed', {id: 'in_rehearsal_3', object: 'invoice', subscription: 'sub_rehearsal_1', billing_reason: 'subscription_cycle', amount_due: 20000, livemode: false});
  await family.goto(BASE + '/family'); await waitText(family, '#membershipCards', /needs attention/i);
});
await step('a late Stripe event for an upfront order started before #210 still records it, with its 12-month term', async () => {
  const at = new Date(Date.now() - 20 * 60000).toISOString();
  sql(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,stripe_session_id)
    VALUES ('late-upfront','e2e-family-a','family.a@example.test','w-sam','Sam Example','annual','Advanced','Advanced','SWA Advance: 12-month membership, paid upfront','[]',240000,0,240000,'usd','{}','{}','pending','late-upfront',0,'${at}','${at}','cs_test_late_upfront')`);
  const r = await webhook('checkout.session.completed', {id: 'cs_test_late_upfront', object: 'checkout.session', client_reference_id: 'late-upfront', metadata: {order_id: 'late-upfront'}, payment_status: 'paid', amount_total: 240000, currency: 'usd', livemode: false, payment_intent: 'pi_rehearsal_upfront', mode: 'payment'});
  expect(r.status === 200 && r.body.outcome === 'paid', 'late upfront webhook ' + JSON.stringify(r.body));
  const o = sql("SELECT status,term_start,term_end FROM orders WHERE id='late-upfront'")[0];
  expect(o.status === 'paid' && o.term_start && o.term_end > o.term_start, 'late upfront order ' + JSON.stringify(o));
  await family.goto(BASE + '/family'); await waitText(family, '#purchaseList', /paid upfront/);
});

await step('card fees for a monthly membership ask Stripe for its invoices; a run with nothing new is not an error (#42)', async () => {
  // stripe-mock's invoices are not for the membership's amount, so no fee is recorded, but the calls must be valid.
  const r = await api(owner, '/api/financials', {action: 'fees'});
  expect(r.status === 200 && !r.body.error && r.body.failed === 0 && r.body.checked >= 0, 'fee run ' + JSON.stringify(r.body));
});
// Pay cash at the academy (issue #248): offered beside online payment, and the two never overlap.
await step('with online payment open, a family can still book a walk-in to pay cash; checkout then refuses it; the owner records the cash', async () => {
  await family.goto(BASE + `/register?plan=walkin&program=Intermediate&date=${ny(3)}`);
  await family.waitForFunction(() => document.querySelectorAll('#wrestler option').length > 0 && !document.querySelector('#reviewButton')?.disabled);
  await family.click('#reviewButton'); await family.waitForSelector('#payChoice:not([hidden])');
  expect(await family.isVisible('#payOnlineOption') && await family.isChecked('#payWayOnline') && await family.isVisible('#acceptTerms'), 'Pay online is offered and chosen first');
  await family.check('#payWayCash'); await family.waitForSelector('#cashBox:not([hidden])');
  expect(!(await family.isVisible('#payButton')), 'the checkout button is hidden while cash is chosen');
  await family.click('#cashButton'); await waitText(family, '#cashDone', /Pay at the academy: \$40\.00 due/);
  const practiceId = sql(`SELECT item_id FROM cash_bookings WHERE session_date='${ny(3)}'`)[0].item_id;
  const r = await api(family, '/api/checkout', {source: 'membership', wrestlerId: 'w-sam', program: 'Intermediate', plan: 'walkin', date: ny(3), practiceId, acceptTerms: true});
  expect(r.status === 409 && /already booked to pay cash/.test(r.body.error), 'checkout refused for a cash booking: ' + JSON.stringify(r.body));
  expect(!sql(`SELECT id FROM orders WHERE kind='walkin' AND dates LIKE '%${ny(3)}%'`).length, 'no order was created');
  await owner.goto(BASE + '/payments'); await waitText(owner, '#cashRows', /Sam Example[\s\S]*\$40\.00 due/);
  await owner.locator('[data-cash-paid]').first().click(); await waitText(owner, '#status', /Cash received for Sam Example/);
  await waitText(owner, '#cashSummary', /Nothing is waiting to be paid at the academy/);
  const o = sql(`SELECT status,source,amount_cents,pricing FROM orders WHERE kind='walkin' AND dates LIKE '%${ny(3)}%'`)[0];
  expect(o && o.status === 'paid' && o.source === 'offline' && o.amount_cents === 4000 && JSON.parse(o.pricing).method === 'cash', 'cash recorded as an offline payment ' + JSON.stringify(o));
});

await browser.close(); auth.close();
console.log(`\n${passed.length} steps passed, ${problems.length} problem(s).`);
for (const p of problems) console.log(' - ' + p);
process.exit(problems.length ? 1 : 0);
