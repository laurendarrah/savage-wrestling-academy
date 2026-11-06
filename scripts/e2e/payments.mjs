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
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8799', AUTH = 'http://127.0.0.1:54321', SECRET = process.env.E2E_WEBHOOK_SECRET;
const auth = await start(54321), browser = await playwright.chromium.launch();
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
  const f = await api(family, '/api/family', {revision: 0, data: {parentName: 'Pat Example', phone: '', wrestlers: [{id: 'w-sam', name: 'Sam Example', grade: '8', usawNumber: 'AB-123456', usawExpires: ny(300)}]}}, 'PUT');
  expect(f.status === 200, 'family ' + JSON.stringify(f.body));
});
await step('owner saves a Stripe test key; Stripe confirms the account', async () => {
  await owner.goto(BASE + '/payment-setup'); await owner.waitForSelector('#testKey');
  await owner.fill('#testKey', 'rk_test_' + 'R'.repeat(24)); await owner.click('#keyForm button');
  await owner.waitForFunction(() => /saved|connected|configured/i.test(document.body.textContent), null, {timeout: 10000});
});
await step('family pays for a walk-in: checkout opens a Stripe session', async () => {
  await family.goto(BASE + '/register'); await family.waitForFunction(() => document.querySelectorAll('#wrestler option').length > 0);
  await family.selectOption('#plan', 'walkin'); await family.selectOption('#program', 'Intermediate');
  await family.locator(`[data-day="${ny(1)}"]`).first().click(); await family.locator('[data-slot]').first().click();
  await family.click('#reviewButton'); await family.waitForSelector('#acceptTerms', {state: 'visible'});
  await family.check('#acceptTerms');
  await Promise.all([family.waitForURL(/checkout\.stripe\.com/, {timeout: 15000}), family.click('#payButton')]);
  const o = sql("SELECT id,status,amount_cents,stripe_session_id FROM orders WHERE kind='walkin'")[0];
  expect(o && o.status === 'pending' && o.amount_cents === 4000 && /^cs_test_/.test(o.stripe_session_id), 'pending order ' + JSON.stringify(o));
  walkinOrder = o.id;
});
await step('Stripe reports the payment: the walk-in is paid and on the roster', async () => {
  const o = sql(`SELECT stripe_session_id FROM orders WHERE id='${walkinOrder}'`)[0];
  let r = await webhook('checkout.session.completed', {id: o.stripe_session_id, object: 'checkout.session', client_reference_id: walkinOrder, metadata: {order_id: walkinOrder}, payment_status: 'paid', amount_total: 4000, currency: 'usd', livemode: false, payment_intent: 'pi_rehearsal_walkin', mode: 'payment'});
  expect(r.status === 200, 'webhook ' + JSON.stringify(r.body));
  await family.goto(BASE + `/family?checkout=success&order=${walkinOrder}`); await waitText(family, '#status', /Payment confirmed/);
  await waitText(family, '#purchaseList', /walk-in[\s\S]*Paid/i);
  const roster = await api(owner, '/api/roster?date=' + ny(1));
  expect(roster.body.sessions.some(s => s.entries.some(e => e.name === 'Sam Example' && e.sources.includes('Walk-in paid'))), 'not on roster');
  // A forged or replayed message changes nothing.
  const bad = await fetch(BASE + '/api/stripe-webhook', {method: 'POST', headers: {'content-type': 'application/json', 'stripe-signature': 't=1,v1=00'}, body: '{}'}); expect(bad.status === 400, 'unsigned webhook accepted: ' + bad.status);
});
await step('the payment shows on /payments as online', async () => {
  await owner.goto(BASE + '/payments'); await waitText(owner, '#rows', /Sam Example[\s\S]*\$40\.00/);
});
await step('a refund in Stripe marks the walk-in refunded and takes Sam off that roster', async () => {
  const r = await webhook('charge.refunded', {id: 'ch_rehearsal_1', object: 'charge', payment_intent: 'pi_rehearsal_walkin', refunded: true, amount_refunded: 4000, livemode: false});
  expect(r.status === 200, 'refund webhook ' + JSON.stringify(r.body));
  await family.goto(BASE + '/family'); await waitText(family, '#purchaseList', /Refunded/);
  const roster = await api(owner, '/api/roster?date=' + ny(1));
  expect(!roster.body.sessions.some(s => s.entries.some(e => e.name === 'Sam Example')), 'still on roster after refund');
});
await step('family starts a 12-month membership paid monthly: a Stripe subscription checkout', async () => {
  await family.goto(BASE + '/register'); await family.waitForFunction(() => document.querySelectorAll('#wrestler option').length > 0);
  await family.selectOption('#plan', 'monthly'); await family.selectOption('#program', 'Intermediate');
  await family.click('#reviewButton'); await family.waitForSelector('#acceptTerms', {state: 'visible'}); await family.check('#acceptTerms');
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

await browser.close(); auth.close();
console.log(`\n${passed.length} steps passed, ${problems.length} problem(s).`);
for (const p of problems) console.log(' - ' + p);
process.exit(problems.length ? 1 : 0);
