// Issue #271 (audit O3, M4, UX 12): the owner's Payment attempts list (every online checkout with Stripe's last word in
// plain words), the Payment needs attention list, refused Stripe messages reaching the owner through the hourly alert,
// and the payments and cards tables stacking into cards on phones.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {makeDb, loader, call} from './fixtures/d1.mjs';

const {sqlite, DB} = makeDb();
const env = {DB};
const load = loader(env, {owner: true, id: 'owner-id'});
const outcomes = load('lib/stripe-outcomes.ts'), alerts = load('lib/owner-alerts.ts'), webhook = load('lib/stripe-webhook.ts'), paymentsApi = load('app/api/payments/route.ts');
const now = Date.now(), iso = min => new Date(now - min * 60000).toISOString();
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('p1', 'pat@example.test', JSON.stringify({parentName: 'Pat Example', phone: '', wrestlers: [{id: 'w1', name: 'Sam Example', grade: '8'}]}), 1, iso(0));
const order = (id, status, min, extra = {}) => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,stripe_session_id,livemode,created_at,updated_at,paid_at,source)
  VALUES (?,?,?,?,?,?,?,?,?,'[]',4000,0,4000,'usd','{}','{}',?,?,?,?,?,?,?,?)`).run(id, extra.user ?? 'p1', extra.email ?? 'pat@example.test', 'w1', extra.wrestler ?? 'Sam Example', extra.kind ?? 'walkin', 'Intermediate', 'x', extra.label ?? 'SWA Intermediate walk-in', status, 'k-' + id, extra.session === null ? null : 'cs_' + id, 0, iso(min), iso(min), status === 'paid' ? iso(min) : null, extra.source ?? 'stripe');
const event = (id, orderId, type, outcome, min) => sqlite.prepare('INSERT INTO stripe_events VALUES (?,?,?,?,?)').run(id, type, orderId, outcome, iso(min));

// --- Plain words for every outcome ---
assert.equal(outcomes.outcomeWords('paid', 'paid'), 'Paid.');
assert.equal(outcomes.outcomeWords('installment-3', 'paid'), 'Monthly payment 3 received.');
assert.equal(outcomes.outcomeWords('installment-3-of-12', 'paid'), 'Monthly payment 3 received.', 'recorded before memberships became month to month');
assert.equal(outcomes.outcomeWords('subscription-paused', 'paid'), 'Stripe stopped retrying the card, so the membership is paused. Nothing more is charged.');
assert.equal(outcomes.outcomeWords('rejected:amount-mismatch', 'pending'), 'Refused: The amount paid did not match the price.');
assert.equal(outcomes.outcomeWords('rejected:something-new', 'pending'), 'Refused: Stripe sent a payment message the site could not match.');
assert.match(outcomes.outcomeWords(null, 'pending'), /^Checkout opened; no answer from Stripe yet/);
assert.match(outcomes.outcomeWords(null, 'expired'), /closed without a payment/);
assert.match(outcomes.outcomeWords('expired', 'expired'), /did not finish paying/);
assert.equal(outcomes.attemptState('rejected:unknown-order', 'pending'), 'rejected'); assert.equal(outcomes.attemptState(null, 'pending'), 'open');
assert.equal(outcomes.attemptState('payment-failed', 'expired'), 'failed'); assert.equal(outcomes.attemptState('paid', 'paid'), 'paid'); assert.equal(outcomes.attemptState(null, 'canceled'), 'closed');

// --- The attempts list: newest first, each order with its latest Stripe message, searchable ---
order('abandoned', 'pending', 50);
order('timed-out', 'expired', 40); event('evt_exp', 'timed-out', 'checkout.session.expired', 'expired', 39);
order('paid-ok', 'paid', 30); event('evt_paid_1', 'paid-ok', 'checkout.session.completed', 'awaiting-payment', 29); event('evt_paid_2', 'paid-ok', 'checkout.session.async_payment_succeeded', 'paid', 28);
order('refused', 'pending', 20); event('evt_bad', 'refused', 'checkout.session.completed', 'rejected:amount-mismatch', 19);
order('replaced', 'canceled', 10, {session: null});
order('cash', 'paid', 5, {source: 'offline'});
order('other-family', 'pending', 60, {user: 'p2', email: 'lee@example.test', wrestler: 'Lee Other'});
let r = await call(paymentsApi, '/api/payments?attempts=1');
assert.equal(r.status, 200); assert.equal(r.body.more, false);
assert.deepEqual(r.body.attempts.map(a => a.id), ['replaced', 'refused', 'paid-ok', 'timed-out', 'abandoned', 'other-family'], 'online orders only, newest first');
const by = id => r.body.attempts.find(a => a.id === id);
assert.equal(by('abandoned').words, outcomes.outcomeWords(null, 'pending')); assert.equal(by('abandoned').state, 'open'); assert.equal(by('abandoned').sessionId, 'cs_abandoned'); assert.equal(by('abandoned').parent, 'Pat Example');
assert.equal(by('timed-out').outcome, 'expired'); assert.equal(by('timed-out').lastEventType, 'checkout.session.expired'); assert.equal(by('timed-out').state, 'closed');
assert.equal(by('paid-ok').outcome, 'paid', 'the latest message, not the first'); assert.equal(by('paid-ok').state, 'paid');
assert.equal(by('refused').words, 'Refused: The amount paid did not match the price.'); assert.equal(by('refused').state, 'rejected');
assert.equal(by('replaced').sessionId, null); assert.match(by('replaced').words, /canceled before payment/);
assert.equal(by('other-family').parent, '', 'a family with no profile');
r = await call(paymentsApi, '/api/payments?attempts=1&q=lee');
assert.deepEqual(r.body.attempts.map(a => a.id), ['other-family'], 'found by email');
r = await call(paymentsApi, '/api/payments?attempts=1&q=pat%20ex');
assert.equal(r.body.attempts.length, 5, 'found by the parent name');
assert.equal((await call(paymentsApi, '/api/payments?attempts=1&q=%27%3B%20DROP')).body.attempts.length, 0, 'a search is only a search');

// --- A refused Stripe message reaches the owner through the hourly alert ---
// Email is set up, but the provider is unreachable in tests (the loader's fetch throws), so a send is recorded as failed:
// enough to see that the webhook itself raised the alert, with the refusal counted.
env.EMAIL_API_KEY = 'k'; env.MAIL_FROM = 'SWA <a@swa.example>';
const at = new Date(now + 60000);
let res = await webhook.applyStripeEvent({id: 'evt_unknown', type: 'checkout.session.completed', livemode: false, data: {object: {id: 'cs_x', client_reference_id: 'no-such-order', payment_status: 'paid', livemode: false, amount_total: 4000, currency: 'usd'}}});
assert.equal(res.outcome, 'rejected:unknown-order');
const refusedRows = sqlite.prepare("SELECT * FROM security_events WHERE action='stripe_event_rejected'").all();
assert.equal(refusedRows.length, 1); assert.match(refusedRows[0].target, /^evt_unknown rejected:unknown-order$/);
let marker = JSON.parse(sqlite.prepare("SELECT payload FROM academy_settings WHERE id='owner-alert'").get().payload);
assert.equal(marker.count, 1, 'the webhook raised the alert for the refusal'); assert.equal(marker.coveredUntil, refusedRows[0].created_at); assert.equal(marker.status, 'failed', 'no provider in tests');
assert.equal(await alerts.alertOwner(DB, at), 'waiting', 'not again within the hour');
// The alert reads the security log beside the error log and words the refusal.
const mail = alerts.alertEmail([{at: iso(0), path: alerts.STRIPE_REFUSED, status: 0, outcome: 'rejected:unknown-order'}, {at: iso(0), path: alerts.STRIPE_REFUSED, status: 0, outcome: 'rejected:unknown-order'}], 'https://swa.test', at);
assert.equal(mail.subject, 'Site alert: 2 payment messages from Stripe refused');
assert.match(mail.text, /Payment messages from Stripe the site refused[^\n]*\n- It named an order the site does not have\. \(2\)/);
assert.match(mail.text, /https:\/\/swa\.test\/payments#attempts/);
const mixed = alerts.alertEmail([{at: iso(0), path: '/register', status: 500}, {at: iso(0), path: alerts.STRIPE_REFUSED, status: 0, outcome: 'rejected:mode-mismatch'}], null, at);
assert.match(mixed.subject, /2 new problems/); assert.match(mixed.text, /Test and live payments were mixed up\. \(1\)/); assert.match(mixed.text, /\/register: unexpected error \(1\)/);
// After the hour, a second refusal is picked up from the security log on its own.
sqlite.prepare("UPDATE academy_settings SET payload=json_set(payload,'$.sentAt','2000-01-01T00:00:00.000Z') WHERE id='owner-alert'").run();
res = await webhook.applyStripeEvent({id: 'evt_unknown_2', type: 'checkout.session.completed', livemode: false, data: {object: {id: 'cs_y', client_reference_id: 'no-such-order', payment_status: 'paid', livemode: false, amount_total: 4000, currency: 'usd'}}});
assert.equal(res.outcome, 'rejected:unknown-order');
marker = JSON.parse(sqlite.prepare("SELECT payload FROM academy_settings WHERE id='owner-alert'").get().payload);
assert.equal(marker.count, 1, 'only the new refusal'); assert.ok(marker.coveredUntil > refusedRows[0].created_at);
delete env.EMAIL_API_KEY; delete env.MAIL_FROM;
console.log('Passed: payment attempts list with plain words and search; refused Stripe messages reach the hourly alert.');

// --- Pages (inline JavaScript is not typechecked): the attempts and attention rows, and tables that stack on phones ---
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
{
  const html = readFileSync('app/payments/screen.html', 'utf8'), script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const ctx = {esc, Intl, Date, Number, String};
  vm.runInNewContext(['const money=', 'const longDate=', 'const fullTime=', 'function attentionRow(', 'const STATE=', 'function attemptRow('].map(start => { const i = script.indexOf(start); assert.ok(i >= 0, start); return script.slice(i, script.indexOf('\n', i)); }).join('\n') + ';this.attentionRow=attentionRow;this.attemptRow=attemptRow', ctx);
  const row = ctx.attemptRow({id: 'x', at: '2026-11-08T23:10:00Z', state: 'rejected', livemode: false, wrestler: 'Sam Example', parent: 'Pat Example', email: 'pat@example.test', item: 'SWA Intermediate walk-in', amountCents: 4000, sessionId: 'cs_test_123', words: 'Refused: The amount paid did not match the price.', lastEventAt: '2026-11-08T23:11:00Z'});
  assert.match(row, /<td data-label="Started">Nov 8, 6:10 PM<br><span class="muted">Test mode<\/span><\/td>/);
  assert.match(row, /<td data-label="Family"><b>Sam Example<\/b><br><span class="muted">Pat Example · pat@example.test<\/span><\/td>/);
  assert.match(row, /<td data-label="Stripe session"><span class="session-id">cs_test_123<\/span><\/td>/);
  assert.match(row, /<td data-label="What happened"><span class="badge rejected">Refused<\/span><br>Refused: The amount paid did not match the price\.<br><span class="muted">Stripe’s last message Nov 8, 6:11 PM<\/span><\/td>/);
  assert.match(ctx.attemptRow({id: 'y', at: '2026-11-08T23:10:00Z', state: 'open', livemode: true, wrestler: 'S', parent: '', email: 'e', item: 'i', amountCents: 1, sessionId: null, words: 'w'}), /Never reached Stripe/);
  const att = ctx.attentionRow({wrestler: 'Sam Example', parent: 'Pat Example', email: 'pat@example.test', phone: '631-555-0100', item: 'SWA Intermediate: monthly membership', amountCents: 20000, paymentsMade: 3, paymentsTotal: 12, failedAt: '2026-11-08T23:10:00Z', failures: 2, paidThrough: '2026-12-05', rosterThrough: '2026-12-12'});
  assert.match(att, /<td data-label="Failed"><span class="badge attn">Payment failed<\/span><br><span class="muted">Nov 8, 6:10 PM · 2 tries<\/span><\/td><td data-label="Paid through">Dec 5, 2026<\/td><td data-label="On the roster through"><b>Dec 12, 2026<\/b><\/td>/);
  assert.match(att, /\$200\.00 a month · 3 payments made/);
  assert.match(html, /<section id="attention" aria-labelledby="attentionHeading" hidden>/); assert.match(html, /<section id="attempts" aria-labelledby="attemptsHeading">/);
  assert.match(html, /<input id="attemptsQ" type="search"/);
  assert.ok(script.includes("call('/api/payments?attention=1')") && script.includes("'/api/payments?attempts=1'"), 'the page loads both lists');
  // UX 12: every owner table on /payments and /cards stacks into cards on a phone, each cell labeled.
  for (const label of ['Paid on', 'Wrestler', 'For', 'Via', 'Collected by', 'Amount', 'Status']) assert.ok(script.includes(`data-label="${label}"`), 'payments: ' + label);
  // Issue #283: the tables are the shared .swa-table, whose rows become two lines on a phone (public/savage.css).
  assert.equal((html.match(/<div class="table" role="region"[^>]*>\s*<table class="swa-table">/g) || []).length, 5, 'every table on /payments is the shared table');
  assert.doesNotMatch(html, /class="table stack"/, 'none keeps the old stacked cards');
  const cards = readFileSync('app/cards/screen.html', 'utf8');
  for (const label of ['Wrestler', 'Family', 'Card', 'Status', 'Review']) assert.ok(cards.includes(`data-label="${label}"`), 'cards: ' + label);
  assert.match(cards, /<div class="table stack" role="region" aria-label="Wrestlers and their cards"/);
  const css = readFileSync('public/responsive.css', 'utf8');
  assert.match(css, /@media screen and \(max-width:600px\)\{\n \.stack table,\.stack tbody,\.stack tr,\.stack td\{display:block;width:100%\}/);
  assert.match(css, /\.stack td\[data-label\]::before\{content:attr\(data-label\)/);
  assert.match(css, /\.stack thead\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\)/, 'headers stay for screen readers');
}
console.log('Passed: payments page rows and phone stacking.');
