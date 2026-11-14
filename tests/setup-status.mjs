// Issue #298: the public setup status shows each owner setup step as done or not, and nothing private.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }}; }};
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const module = {exports: {}}; modules.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, JSON, Date, Number, Array, Object, Set, Math, String, Intl, require: name => {
      if (!/^\.\/[a-z-]+$/.test(name)) throw Error(name);
      return load('lib/' + name.slice(2) + '.ts');
    }});
  return modules.get(file);
}
const {setupStatus, SETUP_STEPS} = load('lib/setup-status.ts');
const today = '2026-11-06', now = Date.parse('2026-11-06T15:00:00Z');

// A brand-new site: nothing set up, test mode, nothing open.
let s = await setupStatus(DB, {}, today, now);
assert.deepEqual(Object.keys(s.steps), [...SETUP_STEPS]);
assert.ok(Object.values(s.steps).every(v => v === false), 'nothing is done on a new site');
assert.deepEqual(JSON.parse(JSON.stringify(s.stripe)), {mode: 'test', testKey: false, testWebhook: false, liveKey: false, liveWebhook: false, checkoutProblem: null, webhooks: []});
assert.equal(s.checkoutOpen, 'nothing');

// The owner confirms a test key and publishes a waiver; Lauren adds the webhook secret and opens walk-ins.
const secret = 'whsec_must_not_leak', key = 'rk_test_must_not_leak';
sqlite.prepare("INSERT INTO integration_secrets(id,encrypted,updated_at,updated_by) VALUES ('stripe-test',?,?,?)").run(JSON.stringify({v: 1, secret: key}), '2026-11-06T14:00:00Z', 'owner@example.test');
sqlite.prepare("INSERT INTO waiver_versions(id,kind,title,body,sha256,published_at,published_by) VALUES ('w1','waiver','Secret Waiver Title','Body','x','2026-11-01T00:00:00Z','owner@example.test')").run();
sqlite.prepare("INSERT INTO staff_access(email,name,programs,active,updated_at) VALUES ('coach@example.test','Coach Private','[]',1,'2026-11-01')").run();
const settings = {STRIPE_TEST_WEBHOOK_SECRET: secret, CHECKOUT_KINDS: 'walkin', EMAIL_API_KEY: 're_must_not_leak', MAIL_FROM: 'Private <hello@mail.example.test>', STAFF_MFA: 'off'};
s = await setupStatus(DB, settings, today, now);
assert.equal(s.stripe.testKey, true); assert.equal(s.stripe.testWebhook, true); assert.equal(s.stripe.liveKey, false);
assert.equal(s.steps.stripe, true, 'test key and webhook secret together finish the Stripe step');
assert.equal(s.steps.waiver, true); assert.equal(s.steps.coaches, true); assert.equal(s.steps.email, true); assert.equal(s.steps.checkout, true);
assert.equal(s.checkoutOpen, 'walk-ins');

// Nothing private: no values, names, titles, dates, emails or counts, and no sign-in safety items.
const text = JSON.stringify(s);
for (const bad of ['must_not_leak', 'Secret Waiver', 'Coach Private', 'example.test', '2026-', 'mfa', 'authenticator', 'families', 'health']) assert.ok(!text.includes(bad), bad);
assert.ok(Object.values(s.steps).every(v => typeof v === 'boolean'));

// Issue #319: the latest reason a card checkout couldn't start, from the last day, as the site's own short wording.
assert.equal(s.stripe.checkoutProblem, null);
const logErr = (at, path, status, message) => sqlite.prepare('INSERT INTO error_log(id,at,method,path,status,message) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(), at, 'POST', path, status, message);
logErr(new Date(now - 3 * 86400000).toISOString(), '/api/checkout', 502, 'Card checkout could not start: Stripe could not be reached. Check the key on Online payment setup.');
logErr(new Date(now - 3600000).toISOString(), '/api/roster', 500, 'Error: something else');
assert.equal((await setupStatus(DB, settings, today, now)).stripe.checkoutProblem, null, 'older than a day, or another page: nothing');
logErr(new Date(now - 7200000).toISOString(), '/api/checkout', 502, 'Card checkout could not start: the saved key is missing a Stripe permission (rak_checkout_session_write). Check the key on Online payment setup.');
logErr(new Date(now - 600000).toISOString(), '/api/checkout', 502, 'Card checkout could not start: Stripe did not accept the request (field expires_at). Check the key on Online payment setup.');
s = await setupStatus(DB, settings, today, now);
assert.equal(s.stripe.checkoutProblem, 'Stripe did not accept the request (field expires_at)', 'the newest one');
logErr(new Date(now - 60000).toISOString(), '/api/checkout', 502, 'Card checkout could not start: <script>alert(1)</script> someone@example.test. Check the key on Online payment setup.');
assert.equal((await setupStatus(DB, settings, today, now)).stripe.checkoutProblem, null, 'anything that is not the site’s own wording is not shown');
for (const bad of ['must_not_leak', 'example.test', '2026-']) assert.ok(!JSON.stringify(s).includes(bad), bad);
// Issue #333: once a checkout has started at Stripe after the problem, the old reason is no longer shown.
sqlite.prepare("DELETE FROM error_log WHERE message LIKE '%<script>%'").run();
assert.equal((await setupStatus(DB, settings, today, now)).stripe.checkoutProblem, 'Stripe did not accept the request (field expires_at)');
const order = (id, at, session) => sqlite.prepare("INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,stripe_session_id,created_at,updated_at) VALUES (?,?,?,?,?,'walkin','Intermediate','i','Walk-in','[]',4000,0,4000,'usd','{}','{}','pending',?,0,?,?,?)").run(id, 'u', 'fam@example.test', 'w', 'Sam', id, session, at, at);
order('o-before', new Date(now - 3600000).toISOString(), 'cs_test_before');
assert.equal((await setupStatus(DB, settings, today, now)).stripe.checkoutProblem, 'Stripe did not accept the request (field expires_at)', 'a checkout from before the problem changes nothing');
order('o-failed', new Date(now - 300000).toISOString(), null);
assert.equal((await setupStatus(DB, settings, today, now)).stripe.checkoutProblem, 'Stripe did not accept the request (field expires_at)', 'an order that never reached Stripe changes nothing');
order('o-after', new Date(now - 120000).toISOString(), 'cs_test_after');
assert.equal((await setupStatus(DB, settings, today, now)).stripe.checkoutProblem, null, 'a checkout that started since clears it');

// Issue #337: Stripe notices from the last day, as type, outcome and count; never an id.
const ev = (id, type, outcome, at) => sqlite.prepare('INSERT INTO stripe_events(id,type,order_id,outcome,received_at) VALUES (?,?,?,?,?)').run(id, type, 'order-secret-1', outcome, at);
ev('evt_1', 'checkout.session.completed', 'paid', new Date(now - 7200000).toISOString());
ev('evt_2', 'charge.refunded', 'ignored:unknown-payment', new Date(now - 3600000).toISOString());
ev('evt_3', 'charge.refunded', 'ignored:unknown-payment', new Date(now - 1800000).toISOString());
ev('evt_4', 'invoice.paid', 'installment-2', new Date(now - 3 * 86400000).toISOString());
ev('evt_5', 'weird type <b>', 'paid', new Date(now - 60000).toISOString());
const hooks = JSON.parse(JSON.stringify((await setupStatus(DB, settings, today, now)).stripe.webhooks));
assert.deepEqual(hooks, [{type: 'other', outcome: 'paid', count: 1}, {type: 'charge.refunded', outcome: 'ignored:unknown-payment', count: 2}, {type: 'checkout.session.completed', outcome: 'paid', count: 1}], 'newest first, older than a day left out');
assert.ok(!JSON.stringify(hooks).includes('evt_') && !JSON.stringify(hooks).includes('order-secret'));

// The route is public, read-only and never cached.
const route = readFileSync('app/api/setup-status/route.ts', 'utf8');
assert.match(route, /export const GET = withApi\(GET_\)/); assert.doesNotMatch(route, /export const (POST|PUT|PATCH|DELETE)/);
assert.match(route, /'Cache-Control': 'no-store'/);
console.log('setup status: ok');
