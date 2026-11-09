// Issue #298: the public setup status shows each owner setup step as done or not, and nothing private.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }}; }};
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
assert.deepEqual(JSON.parse(JSON.stringify(s.stripe)), {mode: 'test', testKey: false, testWebhook: false, liveKey: false, liveWebhook: false});
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

// The route is public, read-only and never cached.
const route = readFileSync('app/api/setup-status/route.ts', 'utf8');
assert.match(route, /export const GET = withApi\(GET_\)/); assert.doesNotMatch(route, /export const (POST|PUT|PATCH|DELETE)/);
assert.match(route, /'Cache-Control': 'no-store'/);
console.log('setup status: ok');
