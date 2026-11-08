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
// Issue #255: no Stripe account is built in. The first test key's own account is shown to the owner and recorded only
// after the owner confirms it; later keys must come from it. stripe-mock answers "which account is this key?" (GET
// /v1/account) with a new random acct_ id every time, so the rehearsal reads the recorded id from the page, and a second
// key always looks like another account's key, which shows the refusal.
let stripeAccount = '';
await step('owner saves a Stripe test key: the site shows the key\'s own account, and records it once confirmed', async () => {
  await owner.goto(BASE + '/payment-setup'); await owner.waitForSelector('#testKey');
  await waitText(owner, '#accountLine', /Not connected to a Stripe account yet/);
  await owner.fill('#testKey', 'rk_test_' + 'R'.repeat(24)); await owner.click('#keyForm button');
  await owner.waitForSelector('#confirmBox:not([hidden])', {timeout: 10000});
  expect(/^This key belongs to acct_[A-Za-z0-9]+\. Is this the academy’s Stripe account\?$/.test(await owner.textContent('#confirmText')), 'the confirmation names the Stripe account: ' + await owner.textContent('#confirmText'));
  expect(!sql("SELECT id FROM integration_secrets").length, 'nothing is stored before the owner confirms');
  await owner.click('#confirmYes');
  await waitText(owner, '#accountLine', /^Connected to acct_[A-Za-z0-9]+$/);
  stripeAccount = (await owner.textContent('#accountLine')).match(/acct_[A-Za-z0-9]+/)[0];
  await waitText(owner, '#status', new RegExp('^Connected to ' + stripeAccount + '\\. Your test key is saved'));
  expect(await owner.isVisible('#changeSection') && !(await owner.isVisible('#confirmBox')), 'Connect a different Stripe account is offered');
  expect(sql("SELECT id FROM integration_secrets ORDER BY id").map(r => r.id).join() === 'stripe-account,stripe-test', 'the key and the account are stored');
  const log = sql("SELECT action,target FROM security_events WHERE action LIKE 'stripe_%'");
  expect(log.some(e => e.action === 'stripe_account_recorded' && e.target === stripeAccount) && log.some(e => e.action === 'stripe_test_key_saved'), 'the account is in the security log ' + JSON.stringify(log));
  await owner.goto(BASE + '/security-log'); await waitText(owner, 'main', new RegExp('Stripe account connected[\\s\\S]*' + stripeAccount));
});
await step('a test key that Stripe reports for another account is refused, and the saved key stays', async () => {
  const before = sql("SELECT encrypted FROM integration_secrets WHERE id='stripe-test'")[0].encrypted;
  const r = await api(owner, '/api/payment-setup', {testKey: 'rk_test_' + 'S'.repeat(24), confirmAccount: true});
  expect(r.status === 400 && /different Stripe account/.test(r.body.error) && r.body.error.includes(stripeAccount), 'refused: ' + JSON.stringify(r.body));
  expect(sql("SELECT encrypted FROM integration_secrets WHERE id='stripe-test'")[0].encrypted === before, 'the saved key is unchanged');
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
// Issue #272: rosters are built from the saved schedule, so a save that would drop a paid session is refused, while a
// time change keeps the walk-in (walk-ins are keyed by program and date). Every save is in the security log.
await step('a day off on the paid walk-in\'s date is refused; moving the practice time keeps Sam on the roster (#272)', async () => {
  const got = await api(owner, '/api/academy');
  const dayOff = {...got.body.data, seasons: got.body.data.seasons.map(s => ({...s, excludedDates: [ny(1)]}))};
  let r = await api(owner, '/api/academy', {revision: got.body.revision, data: dayOff}, 'PUT');
  expect(r.status === 409 && /SWA Intermediate on .* has 1 paid walk-in\. Move or refund/.test(r.body.error) && r.body.blocked.length === 1, 'day off refused: ' + JSON.stringify(r.body));
  expect((await api(owner, '/api/academy')).body.revision === got.body.revision, 'nothing was saved');
  const moved = {...got.body.data, seasons: got.body.data.seasons.map(s => ({...s, weekly: s.weekly.map(w => ({...w, start: '18:30'}))}))};
  r = await api(owner, '/api/academy', {revision: got.body.revision, data: moved}, 'PUT');
  expect(r.status === 200, 'time change saved: ' + JSON.stringify(r.body));
  const roster = await api(owner, '/api/roster?date=' + ny(1));
  const s = roster.body.sessions.find(x => x.type === 'practice' && x.program === 'Intermediate');
  expect(s && s.start === '18:30' && s.entries.some(e => e.name === 'Sam Example' && e.sources.includes('Walk-in paid')), 'walk-in kept after the time change: ' + JSON.stringify(roster.body.sessions.map(x => [x.key, x.entries.map(e => e.name)])));
  const log = sql("SELECT target FROM security_events WHERE action='academy_settings_saved' ORDER BY rowid DESC LIMIT 1")[0];
  expect(log && /^schedule changed: SWA Intermediate/.test(log.target), 'the save is in the security log: ' + JSON.stringify(log));
  await owner.goto(BASE + '/security-log'); await waitText(owner, 'main', /Academy settings saved[\s\S]*schedule changed: SWA Intermediate/);
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
await step('the second monthly payment extends paid-through to the next billing day', async () => {
  const before = sql("SELECT paid_through FROM subscriptions")[0].paid_through;
  const r = await webhook('invoice.paid', {id: 'in_rehearsal_2', object: 'invoice', subscription: 'sub_rehearsal_1', billing_reason: 'subscription_cycle', amount_paid: 20000, livemode: false});
  expect(r.status === 200 && r.body.outcome === 'installment-2-of-12', 'invoice.paid ' + JSON.stringify(r.body));
  const s = sql("SELECT payments_made,paid_through,term_start FROM subscriptions")[0];
  expect(s.payments_made === 2 && s.paid_through > before, 'not extended ' + JSON.stringify(s));
  // Issue #271: paid through the billing day itself (the second payment covers through the day the third is due).
  const [y, m, d] = s.term_start.split('-').map(Number), due = new Date(Date.UTC(y, m - 1 + 2, Math.min(d, new Date(Date.UTC(y, m + 2, 0)).getUTCDate()))).toISOString().slice(0, 10);
  expect(s.paid_through === due && sql(`SELECT term_end FROM orders WHERE id='${monthlyOrder}'`)[0].term_end === due, 'paid through the billing day: ' + JSON.stringify(s) + ' expected ' + due);
});
// Issue #271 (audit M4): a failed monthly payment tells the family and the owner, lists the membership under Payment
// needs attention, and keeps the wrestler on the roster for a 7-day grace after the paid-through day.
await step('a failed monthly payment: family and owner told, "Payment needs attention" on /payments, a 7-day grace on the roster', async () => {
  const paidThrough = sql("SELECT paid_through FROM subscriptions")[0].paid_through;
  const r = await webhook('invoice.payment_failed', {id: 'in_rehearsal_3', object: 'invoice', subscription: 'sub_rehearsal_1', billing_reason: 'subscription_cycle', amount_due: 20000, livemode: false});
  expect(r.status === 200 && r.body.outcome === 'installment-failed', 'invoice.payment_failed ' + JSON.stringify(r.body));
  const s = sql("SELECT status FROM subscriptions")[0], o = sql(`SELECT term_end FROM orders WHERE id='${monthlyOrder}'`)[0];
  const grace = new Date(Date.parse(paidThrough + 'T12:00:00Z') + 7 * 864e5).toISOString().slice(0, 10);
  expect(s.status === 'past_due' && o.term_end === grace, 'grace: ' + JSON.stringify({s, o, grace}));
  const told = sql("SELECT kind,user_id FROM notifications WHERE kind IN ('installment_failed','installment_failed_owner') ORDER BY kind");
  expect(told.length === 2 && told[0].kind === 'installment_failed' && told[0].user_id === 'e2e-family-a' && told[1].user_id === null, 'notices ' + JSON.stringify(told));
  await family.goto(BASE + '/family'); await waitText(family, '#membershipCards', /Payment needs attention[\s\S]*can still come to practice through/i);
  if (SHOTS) await family.screenshot({path: `${SHOTS}/pay-family-past-due.png`, fullPage: true});
  await owner.goto(BASE + '/payments'); await waitText(owner, '#attentionRows', /Sam Example[\s\S]*Payment failed/);
  expect((await owner.textContent('#tAttention')).trim() === '1', 'the tile counts it');
  if (SHOTS) await owner.screenshot({path: `${SHOTS}/pay-owner-payments-attention.png`, fullPage: true});
  // The dashboard tile.
  await owner.goto(BASE + '/'); await waitText(owner, '#todayTiles', /Payment needs attention1Monthly payments that failed at Stripe/, 15000);
  if (SHOTS) await owner.screenshot({path: `${SHOTS}/pay-owner-dashboard-attention.png`, fullPage: false});
  // The wrestler is still on the roster during the grace (today is inside it).
  const roster = await api(owner, '/api/roster?date=' + ny(0));
  expect(roster.body.sessions.some(x => x.entries.some(e => e.name === 'Sam Example' && e.sources.includes('Member'))), 'Sam dropped off the roster during the grace');
});
// Issue #271 (audit M5): a payment for another amount (a coupon or a price edit in Stripe) still counts, for the amount
// Stripe collected, and the owner is told about the difference.
await step('a monthly payment for a different amount counts for what Stripe collected and is flagged for the owner', async () => {
  const r = await webhook('invoice.paid', {id: 'in_rehearsal_4', object: 'invoice', subscription: 'sub_rehearsal_1', billing_reason: 'subscription_cycle', amount_paid: 15000, livemode: false});
  expect(r.status === 200 && r.body.outcome === 'installment-3-of-12', 'invoice.paid ' + JSON.stringify(r.body));
  const s = sql("SELECT status,payments_made FROM subscriptions")[0];
  expect(s.status === 'active' && s.payments_made === 3, 'counted ' + JSON.stringify(s));
  const p = sql("SELECT invoice_id,payment_number,amount_cents,expected_cents FROM installment_payments WHERE payment_number=3")[0];
  expect(p && p.invoice_id === 'in_rehearsal_4' && p.payment_number === 3 && p.amount_cents === 15000 && p.expected_cents === 20000, 'stored ' + JSON.stringify(p));
  expect(sql("SELECT target FROM security_events WHERE action='installment_amount_mismatch'").length === 1, 'flagged in the security log');
  expect(sql("SELECT kind FROM notifications WHERE kind='installment_mismatch_owner'").length === 1, 'the owner is told');
  const books = await api(owner, '/api/financials');
  expect(books.body.lines.some(l => l.id === 'installment:' + `evt_rehearsal_${evt}` && l.amountCents === 15000), 'the books show $150.00 for payment 3');
  await owner.goto(BASE + '/payments'); await waitText(owner, '#attentionSummary', /^$|needs attention/);
  expect((await owner.textContent('#tAttention')).trim() === '0', 'paid up again: ' + await owner.textContent('#tAttention'));
  await owner.goto(BASE + '/security-log'); await waitText(owner, 'main', /Monthly payment for a different amount[\s\S]*Stripe collected \$150\.00, the price is \$200\.00/);
});
// Issue #271 (audit O3): every online checkout and Stripe's last word about it, in plain words, on /payments.
await step('the Payment attempts list on /payments shows each checkout with what happened', async () => {
  await owner.goto(BASE + '/payments'); await waitText(owner, '#attemptRows', /Sam Example/);
  const rows = await owner.textContent('#attemptRows');
  expect(/12-month membership, monthly payment[\s\S]*Monthly payment 3 of 12 received\./.test(rows), 'the membership attempt: ' + rows);
  expect(/walk-in[\s\S]*Refunded in full\./.test(rows), 'the refunded walk-in: ' + rows);
  expect(rows.includes(sql(`SELECT stripe_session_id FROM orders WHERE id='${monthlyOrder}'`)[0].stripe_session_id), 'the Stripe session id to look up');
  await owner.fill('#attemptsQ', 'nobody'); await waitText(owner, '#attemptRows', /No online payment attempts match/);
  await owner.fill('#attemptsQ', 'family.a'); await waitText(owner, '#attemptRows', /Sam Example/);
  if (SHOTS) await owner.screenshot({path: `${SHOTS}/pay-owner-payments-attempts.png`, fullPage: true});
  // A refused message is in the security log and raises the owner alert (email is off in the rehearsal, so nothing is sent).
  const r = await webhook('checkout.session.completed', {id: 'cs_test_nowhere', object: 'checkout.session', client_reference_id: 'no-such-order', metadata: {order_id: 'no-such-order'}, payment_status: 'paid', amount_total: 4000, currency: 'usd', livemode: false, mode: 'payment'});
  expect(r.status === 200 && r.body.outcome === 'rejected:unknown-order', 'refused ' + JSON.stringify(r.body));
  await owner.goto(BASE + '/security-log'); await waitText(owner, 'main', /Stripe message refused[\s\S]*It named an order the site does not have/);
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

// Issue #272: coach pay is the coach's share of what the academy kept after a partial refund, and a card dispute is
// recorded, flagged on Payments, logged and booked.
let lessonOrder = '';
await step('a partly refunded lesson pays the coach their share of what the academy kept (#272)', async () => {
  sql(`INSERT INTO staff_access VALUES ('coach.dana@example.test','Coach Dana','["Intermediate"]',1,'2026-11-01T12:00:00.000Z')`);
  sql(`INSERT INTO coach_openings(id,user_id,date,start,end,coach_email) VALUES ('op-rehearsal','e2e-coach','${ny(4)}','16:00','17:00','coach.dana@example.test')`);
  let r = await api(owner, '/api/lesson-settings', {prices: {'one-on-one': 8000}});
  expect(r.status === 200, 'lesson price ' + JSON.stringify(r.body));
  r = await api(family, '/api/checkout', {source: 'booking', type: 'lesson', wrestlerId: 'w-sam', openingId: 'op-rehearsal', acceptTerms: true});
  expect(r.status === 200 && r.body.amountCents === 8000, 'lesson checkout ' + JSON.stringify(r.body));
  lessonOrder = r.body.orderId;
  const o = sql(`SELECT stripe_session_id FROM orders WHERE id='${lessonOrder}'`)[0];
  r = await webhook('checkout.session.completed', {id: o.stripe_session_id, object: 'checkout.session', client_reference_id: lessonOrder, metadata: {order_id: lessonOrder}, payment_status: 'paid', amount_total: 8000, currency: 'usd', livemode: false, payment_intent: 'pi_rehearsal_lesson', mode: 'payment'});
  expect(r.status === 200 && r.body.outcome === 'paid', 'lesson paid ' + JSON.stringify(r.body));
  r = await webhook('charge.refunded', {id: 'ch_rehearsal_lesson', object: 'charge', payment_intent: 'pi_rehearsal_lesson', amount: 8000, refunded: false, amount_refunded: 3000, livemode: false});
  expect(r.body.outcome === 'partial-refund', 'partial refund ' + JSON.stringify(r.body));
  const pay = await api(owner, `/api/coach-pay?from=${ny(0)}&to=${ny(10)}`);
  const dana = pay.body.coaches.find(c => c.coachEmail === 'coach.dana@example.test');
  expect(dana && dana.grossCents === 5000 && dana.refundedCents === 3000 && dana.owedCents === 3250 && dana.lines[0].refundedCents === 3000, 'coach pay nets the refund: ' + JSON.stringify(pay.body.coaches));
  const csv = await owner.evaluate(async q => (await fetch('/api/coach-pay?format=csv&' + q, {cache: 'no-store'})).text(), `from=${ny(0)}&to=${ny(10)}`);
  expect(/,80\.00,30\.00,50\.00,65,32\.50,17\.50\r\n/.test(csv), 'the coach pay spreadsheet shows paid, refunded and kept: ' + csv);
  if (ny(4).slice(0, 7) === ny(0).slice(0, 7)) { await owner.goto(BASE + '/coach-pay'); await waitText(owner, '#coaches', /Coach Dana[\s\S]*\$50\.00 kept \(\$30\.00 refunded\)[\s\S]*Owed \$32\.50/); }
});
await step('the family disputes the lesson payment with their bank: Payments says Disputed, the log and the alert path record it, the books move the money (#272)', async () => {
  const dispute = {id: 'dp_rehearsal_1', object: 'dispute', charge: 'ch_rehearsal_lesson', payment_intent: 'pi_rehearsal_lesson', amount: 5000, currency: 'usd', reason: 'fraudulent', status: 'needs_response', livemode: false};
  let r = await webhook('charge.dispute.created', dispute);
  expect(r.status === 200 && r.body.outcome === 'disputed', 'dispute webhook ' + JSON.stringify(r.body));
  expect(sql(`SELECT kind,amount_cents FROM payment_disputes WHERE order_id='${lessonOrder}'`).some(d => d.kind === 'created' && d.amount_cents === 5000), 'the dispute is recorded');
  expect(sql(`SELECT status FROM orders WHERE id='${lessonOrder}'`)[0].status === 'paid', 'the payment stays paid');
  expect(sql("SELECT path FROM error_log WHERE path='/stripe-dispute'").length === 1, 'the owner alert path has the dispute');
  await owner.goto(BASE + '/payments'); await waitText(owner, '#rows', /Sam Example[\s\S]*Disputed[\s\S]*Answer it in Stripe before its deadline/);
  await owner.goto(BASE + '/security-log'); await waitText(owner, 'main', /Card payment disputed by the family’s bank[\s\S]*Sam Example/);
  r = await webhook('charge.dispute.funds_withdrawn', {...dispute, status: 'under_review'});
  expect(r.body.outcome === 'dispute-funds-withdrawn', 'funds withdrawn ' + JSON.stringify(r.body));
  const books = await api(owner, '/api/financials');
  expect(books.body.lines.some(l => l.type === 'refund' && l.category === 'Disputed payments' && l.amountCents === 5000), 'the dispute is money out in the books: ' + JSON.stringify(books.body.lines.map(l => [l.type, l.category, l.amountCents])));
});

await step('card fees for a monthly membership ask Stripe for its invoices; a run with nothing new is not an error (#42)', async () => {
  // stripe-mock's invoices are not for the membership's amount, so no fee is recorded, but the calls must be valid.
  const r = await api(owner, '/api/financials', {action: 'fees'});
  expect(r.status === 200 && !r.body.error && r.body.failed === 0 && r.body.checked >= 0, 'fee run ' + JSON.stringify(r.body));
});
// Issue #272: Sam's monthly membership covers SWA Intermediate practices, so a walk-in review is refused in plain words.
await step('a member reviewing a walk-in their membership covers is told there is nothing to pay (#272)', async () => {
  await family.goto(BASE + `/register?plan=walkin&program=Intermediate&date=${ny(3)}`);
  await family.waitForFunction(() => document.querySelectorAll('#wrestler option').length > 0 && !document.querySelector('#reviewButton')?.disabled);
  await family.click('#reviewButton'); await waitText(family, '#status', /membership already covers SWA Intermediate practices on .*, so there is nothing to pay for this walk-in/);
  expect(!sql("SELECT id FROM orders WHERE kind='walkin' AND status='pending'").length, 'no walk-in order was started');
  // The rest of the rehearsal buys walk-ins, so the membership is ended here.
  sql(`UPDATE orders SET term_end='${ny(-1)}' WHERE kind='monthly'`);
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

// Last, because it disconnects Stripe (issue #255).
await step('owner chooses Connect a different Stripe account: after the confirmation the key and the account are cleared and logged', async () => {
  await owner.goto(BASE + '/payment-setup'); await waitText(owner, '#accountLine', new RegExp('Connected to .*' + stripeAccount));
  await owner.click('#changeAccount'); await owner.waitForSelector('#resetBox:not([hidden])');
  await owner.click('#resetNo'); expect(sql("SELECT id FROM integration_secrets WHERE id='stripe-account'").length === 1, 'No keeps the account');
  await owner.click('#changeAccount'); await owner.click('#resetYes');
  await waitText(owner, '#accountLine', /Not connected to a Stripe account yet/); await waitText(owner, '#status', /Disconnected/);
  expect(!sql("SELECT id FROM integration_secrets").length, 'test key and account cleared');
  expect(sql("SELECT target FROM security_events WHERE action='stripe_account_reset'").some(e => e.target === stripeAccount), 'the reset is logged');
});

await browser.close(); auth.close();
console.log(`\n${passed.length} steps passed, ${problems.length} problem(s).`);
for (const p of problems) console.log(' - ' + p);
process.exit(problems.length ? 1 : 0);
